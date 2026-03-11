"""
llm.py — LLM client for outfit explanation generation.

Uses OpenAI gpt-4o (vision-capable) to produce a single natural-language
sentence explaining why the selected top and bottom suit the occasion.
Garment images are forwarded to the model when available, filling the
image-consumption gap in the recommendation pipeline.

Environment variables
---------------------
OPENAI_API_KEY  Required. Raises at import time if absent.
OPENAI_MODEL    Optional. Defaults to "gpt-4o". Override to "gpt-4o-mini"
                for cost reduction during development.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from openai import AsyncOpenAI

from .models import GarmentItem

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Client initialisation
# ---------------------------------------------------------------------------

_api_key = os.getenv("OPENAI_API_KEY")
if not _api_key:
    raise EnvironmentError(
        "OPENAI_API_KEY environment variable is not set. "
        "Set it before starting the server."
    )

_model = os.getenv("OPENAI_MODEL", "gpt-4o")

_client = AsyncOpenAI(api_key=_api_key)

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


def _image_block(item: Optional[GarmentItem]) -> Optional[dict]:
    """Return an OpenAI image_url content block if the item has an image URL."""
    if item is None:
        return None
    url = str(item.primary_image_url) if item.primary_image_url else None
    if not url:
        return None
    return {"type": "image_url", "image_url": {"url": url, "detail": "low"}}


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
    Call the LLM to generate a one-sentence outfit explanation.

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

    # Build the user text content
    text_content = (
        f"Day: {day} | Event: {event_label}\n"
        f"{_describe_item('Top', top)}\n"
        f"{_describe_item('Bottom', bottom)}"
    )

    # Assemble the user message — text first, then optional images
    user_content: list[dict] = [{"type": "text", "text": text_content}]

    for block in (_image_block(top), _image_block(bottom)):
        if block is not None:
            user_content.append(block)

    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    try:
        response = await _client.chat.completions.create(
            model=_model,
            messages=messages,
            max_tokens=120,
            temperature=0.7,
        )
        return response.choices[0].message.content.strip()
    except Exception as exc:
        logger.warning(
            "LLM explanation generation failed for %s %s: %s",
            day,
            event_type,
            exc,
        )
        return _FALLBACK_TEMPLATE.format(day=day, event_type=event_label)
