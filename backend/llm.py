"""
llm.py — LLM client for outfit explanation generation.

Uses Google Vertex AI (Gemini) via ADC (Application Default Credentials),
the same auth mechanism as vision/extractor.py.  No API key is needed; the
runtime service account used by Cloud Run (or the local gcloud ADC identity
set up with `gcloud auth application-default login`) grants access automatically.

Environment variables
---------------------
GOOGLE_CLOUD_PROJECT    Required. GCP project that hosts the Vertex AI API.
GOOGLE_CLOUD_LOCATION   Optional. Defaults to "us-central1".
VERTEX_AI_MODEL         Optional. Defaults to "gemini-3.1-pro-preview".
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import os
from functools import lru_cache
from typing import Optional
from urllib.parse import urlparse

import httpx
from google import genai
from google.genai import types

from .models import GarmentItem

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_model = os.getenv("VERTEX_AI_MODEL", "gemini-3.1-pro-preview")


@lru_cache(maxsize=1)
def _gemini_client() -> Optional[genai.Client]:
    """Return a Vertex AI genai.Client, or None if GOOGLE_CLOUD_PROJECT is unset.

    Cached so the client (and its underlying connection pool) is shared across
    all requests for the lifetime of the process.
    """
    project = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    if not project:
        return None
    location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
    return genai.Client(vertexai=True, project=project, location=location)


# ---------------------------------------------------------------------------
# Shared HTTP client — reused across all requests for connection pooling.
# Used only for downloading garment images from Supabase storage URLs.
# ---------------------------------------------------------------------------

_http_client = httpx.AsyncClient(
    timeout=httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0),
    limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
)

# ---------------------------------------------------------------------------
# SSRF protection
# ---------------------------------------------------------------------------

_MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB

_PRIVATE_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),  # link-local / cloud metadata
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]

_BLOCKED_HOSTNAMES = frozenset(
    {
        "metadata.google.internal",
        "169.254.169.254",
        "metadata.azure.com",
        "100.100.100.200",  # Alibaba Cloud metadata
    }
)


def _is_safe_image_url(url: str) -> bool:
    """Return True only for http/https URLs that don't target private infrastructure.

    Note: this validates the URL as-supplied and does not prevent DNS rebinding.
    It is a best-effort guard against the most common SSRF vectors.
    """
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        hostname = (parsed.hostname or "").lower()
        if not hostname:
            return False
        if hostname in _BLOCKED_HOSTNAMES:
            return False
        try:
            addr = ipaddress.ip_address(hostname)
            return not any(addr in net for net in _PRIVATE_NETWORKS)
        except ValueError:
            pass  # Regular hostname — allowed.
    except Exception:
        return False
    return True


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = (
    "You are a concise, friendly personal stylist. "
    "Write exactly one sentence explaining why the selected outfit suits "
    "the occasion. Do not start the sentence with 'I' or repeat the day "
    "or event type word-for-word."
)

_FALLBACK_TEMPLATE = (
    "For your {day} {event_type}, we've put together the best available "
    "pieces from your wardrobe."
)

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _describe_item(label: str, item: Optional[GarmentItem]) -> str:
    """Return a compact text description of a garment for the prompt."""
    if item is None:
        return f"{label}: no suitable item found"

    parts: list[str] = []

    name = item.sub_category or item.category.value
    if item.brand:
        name = f"{item.brand} {name}"
    parts.append(name)

    if item.color_primary:
        parts.append(item.color_primary)
    if item.formality:
        parts.append(item.formality.value.replace("_", "-"))
    if item.material:
        parts.append(item.material)

    return f"{label}: {' — '.join(parts)}"


async def _fetch_image_part(url: str) -> Optional[types.Part]:
    """Download an image from *url* and return a genai Part for inline delivery.

    Returns None (and logs a warning) if the URL fails SSRF validation,
    the request fails, or the response exceeds _MAX_IMAGE_BYTES.
    """
    if not _is_safe_image_url(url):
        logger.warning("Skipping image fetch for disallowed URL: %s", url)
        return None
    try:
        resp = await _http_client.get(url, timeout=10.0)
        resp.raise_for_status()
        if len(resp.content) > _MAX_IMAGE_BYTES:
            logger.warning(
                "Skipping oversized garment image %s (%d bytes)", url, len(resp.content)
            )
            return None
        mime = resp.headers.get("content-type", "image/jpeg").split(";")[0].strip()
        return types.Part.from_bytes(data=resp.content, mime_type=mime)
    except Exception as exc:
        logger.debug("Could not fetch garment image %s: %s", url, exc)
        return None


async def _image_part(item: Optional[GarmentItem]) -> Optional[types.Part]:
    """Return a genai Part for the item's image, or None."""
    if item is None:
        return None
    url = str(item.primary_image_url) if item.primary_image_url else None
    if not url:
        return None
    return await _fetch_image_part(url)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def generate_outfit_explanation(
    day: str,
    event_type: str,
    top: Optional[GarmentItem],
    bottom: Optional[GarmentItem],
) -> str:
    """
    Call the Vertex AI Gemini model to generate a one-sentence outfit explanation.

    Authentication uses ADC — no API key required. In Cloud Run the runtime
    service account is used automatically. Locally, run:
        gcloud auth application-default login

    Args:
        day:        Day of the week, e.g. ``"Monday"``.
        event_type: Event label, e.g. ``"work_meeting"``.
        top:        Selected top garment, or ``None`` if unavailable.
        bottom:     Selected bottom garment, or ``None`` if unavailable.

    Returns:
        A single natural-language sentence. Falls back to a safe template
        string if GOOGLE_CLOUD_PROJECT is unset or the API call fails, so
        the recommendations endpoint never crashes.
    """
    event_label = event_type.replace("_", " ")

    client = _gemini_client()
    if client is None:
        logger.warning(
            "GOOGLE_CLOUD_PROJECT is not set; returning fallback for %s %s",
            day,
            event_type,
        )
        return _FALLBACK_TEMPLATE.format(day=day, event_type=event_label)

    text_part = types.Part.from_text(
        text=(
            f"Day: {day} | Event: {event_label}\n"
            f"{_describe_item('Top', top)}\n"
            f"{_describe_item('Bottom', bottom)}"
        )
    )

    user_parts: list[types.Part] = [text_part]
    for part in [await _image_part(top), await _image_part(bottom)]:
        if part is not None:
            user_parts.append(part)

    try:
        # Run the synchronous SDK call in a thread so the event loop is not blocked.
        response = await asyncio.to_thread(
            client.models.generate_content,
            model=_model,
            contents=user_parts,
            config=types.GenerateContentConfig(
                system_instruction=_SYSTEM_PROMPT,
                max_output_tokens=120,
                temperature=0.7,
            ),
        )
        text = (response.text or "").strip()
        return text or _FALLBACK_TEMPLATE.format(day=day, event_type=event_label)
    except Exception as exc:
        logger.warning(
            "LLM explanation generation failed for %s %s: %s",
            day,
            event_type,
            exc,
        )
        return _FALLBACK_TEMPLATE.format(day=day, event_type=event_label)
