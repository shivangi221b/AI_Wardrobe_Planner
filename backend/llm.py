"""
llm.py — LLM client for outfit explanation generation.

Uses Google Vertex AI (Gemini) to produce a single natural-language sentence
explaining why the selected top and bottom suit the occasion.
Garment images are forwarded to the model when available, encoded as inline
base64 data so the REST endpoint can process them without GCS.

Environment variables
---------------------
VERTEX_AI_API_KEY   Required at call time. Missing key returns the fallback
                    template so the server can still start without it.
VERTEX_AI_MODEL     Optional. Defaults to "gemini-3.1-pro-preview".
"""

from __future__ import annotations

import base64
import ipaddress
import logging
import os
from typing import Optional
from urllib.parse import urlparse

import httpx

from .models import GarmentItem

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_model = os.getenv("VERTEX_AI_MODEL", "gemini-3.1-pro-preview")

# API key and endpoint URL are resolved lazily at call time so that missing
# VERTEX_AI_API_KEY does not prevent the server from starting.
def _get_endpoint_url() -> Optional[str]:
    api_key = os.getenv("VERTEX_AI_API_KEY", "").strip()
    if not api_key:
        return None
    return (
        f"https://aiplatform.googleapis.com/v1/publishers/google/models/"
        f"{_model}:generateContent?key={api_key}"
    )

# ---------------------------------------------------------------------------
# Shared HTTP client — reused across all requests for connection pooling.
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
        # If the hostname is an IP literal, reject private/reserved ranges.
        try:
            addr = ipaddress.ip_address(hostname)
            return not any(addr in net for net in _PRIVATE_NETWORKS)
        except ValueError:
            pass  # It's a regular hostname — allowed.
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


async def _fetch_image_as_inline_data(url: str) -> Optional[dict]:
    """Download an image from *url* and return a Gemini inlineData part.

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
        encoded = base64.b64encode(resp.content).decode("utf-8")
        return {"inlineData": {"mimeType": mime, "data": encoded}}
    except Exception as exc:
        logger.debug("Could not fetch garment image %s: %s", url, exc)
        return None


async def _image_part(item: Optional[GarmentItem]) -> Optional[dict]:
    """Return a Gemini inlineData part for the item's image, or None."""
    if item is None:
        return None
    url = str(item.primary_image_url) if item.primary_image_url else None
    if not url:
        return None
    return await _fetch_image_as_inline_data(url)


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

    Args:
        day:        Day of the week, e.g. ``"Monday"``.
        event_type: Event label, e.g. ``"work_meeting"``.
        top:        Selected top garment, or ``None`` if unavailable.
        bottom:     Selected bottom garment, or ``None`` if unavailable.

    Returns:
        A single natural-language sentence. Falls back to a safe template
        string if VERTEX_AI_API_KEY is missing or the API call fails so the
        endpoint never crashes.
    """
    event_label = event_type.replace("_", " ")

    endpoint_url = _get_endpoint_url()
    if not endpoint_url:
        logger.warning(
            "VERTEX_AI_API_KEY is not set; returning fallback for %s %s",
            day,
            event_type,
        )
        return _FALLBACK_TEMPLATE.format(day=day, event_type=event_label)

    text_content = (
        f"Day: {day} | Event: {event_label}\n"
        f"{_describe_item('Top', top)}\n"
        f"{_describe_item('Bottom', bottom)}"
    )

    # Build user parts: text first, then optional inline images
    user_parts: list[dict] = [{"text": text_content}]

    for part in [await _image_part(top), await _image_part(bottom)]:
        if part is not None:
            user_parts.append(part)

    payload = {
        "systemInstruction": {
            "parts": [{"text": _SYSTEM_PROMPT}]
        },
        "contents": [
            {"role": "user", "parts": user_parts}
        ],
        "generationConfig": {
            "maxOutputTokens": 120,
            "temperature": 0.7,
        },
    }

    try:
        response = await _http_client.post(endpoint_url, json=payload, timeout=30.0)
        response.raise_for_status()
        data = response.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        return text.strip()
    except Exception as exc:
        logger.warning(
            "LLM explanation generation failed for %s %s: %s",
            day,
            event_type,
            exc,
        )
        return _FALLBACK_TEMPLATE.format(day=day, event_type=event_label)
