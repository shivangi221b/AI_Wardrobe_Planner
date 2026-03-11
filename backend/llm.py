"""
llm.py — LLM client for outfit explanation generation.

Uses Google Vertex AI (Gemini) to produce a single natural-language sentence
explaining why the selected top and bottom suit the occasion.
Garment images are forwarded to the model when available, encoded as inline
base64 data so the REST endpoint can process them without GCS.

Environment variables
---------------------
VERTEXAI_API_KEY   Required. Raises at import time if absent.
VERTEX_AI_MODEL     Optional. Defaults to "gemini-3.1-pro-preview".
"""

from __future__ import annotations

import base64
import logging
import os
from typing import Optional

import httpx

from .models import GarmentItem

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_api_key = os.getenv("VERTEXAI_API_KEY")
if not _api_key:
    raise EnvironmentError(
        "VERTEX_AI_API_KEY environment variable is not set. "
        "Set it before starting the server."
    )

_model = os.getenv("VERTEX_AI_MODEL", "gemini-3.1-pro-preview")
_endpoint_url = (
    f"https://aiplatform.googleapis.com/v1/publishers/google/models/"
    f"{_model}:generateContent?key={_api_key}"
)

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
    """Download an image from *url* and return a Gemini inlineData part."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
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
        string if the API call fails so the endpoint never crashes.
    """
    event_label = event_type.replace("_", " ")

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
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(_endpoint_url, json=payload)
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
