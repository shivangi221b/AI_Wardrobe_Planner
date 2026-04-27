"""
outfit_on_avatar.py — AI-powered outfit-on-avatar image generation.

Two-strategy approach, tried in order:

1. **Imagen personalized generation** (``imagen-3.0-capability-001``)
   Uses Vertex AI Imagen's ``SubjectReferenceImage`` with
   ``SUBJECT_TYPE_PERSON`` to anchor the generated image to the stored
   avatar portrait.  The model preserves the person's face, hair, and
   body type while generating a full-body image of them wearing the
   recommended outfit items (described via the text prompt from garment
   metadata).  Fallback activates on any API error.

2. **Gemini multimodal image generation** (``gemini-2.0-flash-exp``)
   Sends the avatar portrait bytes + each garment photo byte to Gemini
   with ``response_modalities=["IMAGE"]``.  The model sees both the face
   and the actual garment visuals.  Falls back if the model is
   unavailable on this Vertex AI project or returns no image.

3. **PIL composite fallback** (``outfit_composite.build_outfit_composite``)
   Deterministic side-by-side stitching — always succeeds.
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
from typing import Sequence

import httpx
from PIL import Image

from .llm import _is_safe_image_url

logger = logging.getLogger(__name__)

_MAX_BYTES = 10 * 1024 * 1024   # 10 MB per image
_HTTP_TIMEOUT = 15.0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _fetch_bytes(url: str, client: httpx.AsyncClient) -> bytes | None:
    if not url.strip():
        return None
    if not _is_safe_image_url(url):
        logger.warning("outfit_on_avatar: blocked unsafe URL url=%s", url)
        return None
    try:
        resp = await client.get(url, timeout=_HTTP_TIMEOUT, follow_redirects=True)
        resp.raise_for_status()
        data = resp.content
        if len(data) > _MAX_BYTES:
            logger.warning("outfit_on_avatar: image too large (%d B) url=%s", len(data), url)
            return None
        return data
    except Exception as exc:
        logger.warning("outfit_on_avatar: fetch failed url=%s: %s", url, exc)
        return None


def _to_jpeg(raw: bytes) -> bytes:
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=92)
    return out.getvalue()


def _outfit_description(garment_items: Sequence[dict]) -> str:
    """Build a natural-language outfit description from garment metadata."""
    parts: list[str] = []
    for item in garment_items:
        name = (item.get("name") or "").strip()
        category = (item.get("category") or "").strip()
        if name:
            parts.append(f"{name}" + (f" ({category})" if category else ""))
    return ", ".join(parts) if parts else "a complete outfit"


# ---------------------------------------------------------------------------
# Strategy 1 — Imagen 3 personalized generation (SubjectReferenceImage)
# ---------------------------------------------------------------------------

async def _imagen_outfit(
    avatar_bytes: bytes,
    garment_items: Sequence[dict],
) -> bytes | None:
    """
    Use Vertex AI Imagen ``edit_image`` with ``SubjectReferenceImage``
    (``SUBJECT_TYPE_PERSON``) to generate an image of the avatar wearing
    the outfit.

    In google-genai v1.x the ``reference_images`` list is a top-level
    parameter of ``edit_image``, not inside ``GenerateImagesConfig`` /
    ``EditImageConfig``.
    """
    project = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    if not project:
        logger.info("outfit_on_avatar[imagen]: GOOGLE_CLOUD_PROJECT not set — skipping")
        return None

    try:
        from google import genai
        from google.genai import types as genai_types
    except ImportError:
        logger.warning("outfit_on_avatar[imagen]: google-genai not installed")
        return None

    location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
    client = genai.Client(vertexai=True, project=project, location=location)

    model = os.getenv("OUTFIT_PREVIEW_IMAGEN_MODEL", "imagen-3.0-capability-001").strip()

    outfit_desc = _outfit_description(garment_items)
    prompt = (
        f"Full body fashion illustration of person [1] wearing {outfit_desc}. "
        "Show the complete outfit from head to toe, person standing upright facing forward. "
        "All clothing items clearly visible. "
        "Character illustration style, plain off-white background."
    )

    logger.info(
        "outfit_on_avatar[imagen]: calling model=%s avatar_bytes=%d",
        model,
        len(avatar_bytes),
    )

    try:
        # In google-genai v1.x the reference_images for personalized generation
        # go on edit_image() as a top-level parameter, NOT inside GenerateImagesConfig.
        response = await asyncio.to_thread(
            client.models.edit_image,
            model=model,
            prompt=prompt,
            reference_images=[
                genai_types.SubjectReferenceImage(
                    reference_id=1,
                    reference_image=genai_types.Image(
                        image_bytes=avatar_bytes,
                        mime_type="image/jpeg",
                    ),
                    config=genai_types.SubjectReferenceConfig(
                        subject_type=genai_types.SubjectReferenceType.SUBJECT_TYPE_PERSON,
                    ),
                )
            ],
            config=genai_types.EditImageConfig(
                number_of_images=1,
                aspect_ratio="9:16",
                person_generation="allow_adult",
            ),
        )
    except Exception as exc:
        logger.warning("outfit_on_avatar[imagen]: Imagen call failed: %s", exc)
        return None

    generated = getattr(response, "generated_images", None) or []
    for gen_img in generated:
        img = getattr(gen_img, "image", None)
        if img:
            raw = getattr(img, "image_bytes", None)
            if raw:
                logger.info(
                    "outfit_on_avatar[imagen]: Imagen returned image bytes=%d", len(raw)
                )
                try:
                    return _to_jpeg(raw)
                except Exception:
                    return raw  # type: ignore[return-value]

    logger.warning("outfit_on_avatar[imagen]: Imagen returned no images in response")
    return None


# ---------------------------------------------------------------------------
# Strategy 2 — Gemini multimodal image generation
# ---------------------------------------------------------------------------

async def _gemini_outfit(
    avatar_bytes: bytes,
    garment_bytes_list: list[bytes],
    garment_items: Sequence[dict],
) -> bytes | None:
    """
    Use Gemini 2.0 Flash Experimental image generation.

    The model receives the avatar portrait + each garment image directly,
    so it can see both the face AND the actual garment visuals.  Requires
    ``gemini-2.0-flash-exp`` (or the model set via
    ``OUTFIT_PREVIEW_GEMINI_MODEL``) to be accessible on this Vertex AI
    project.
    """
    project = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    if not project:
        return None

    try:
        from google import genai
        from google.genai import types as genai_types
    except ImportError:
        return None

    location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
    client = genai.Client(vertexai=True, project=project, location=location)
    model = os.getenv("OUTFIT_PREVIEW_GEMINI_MODEL", "gemini-2.0-flash-exp").strip()

    outfit_desc = _outfit_description(garment_items)
    prompt = (
        "You are an AI fashion illustrator. "
        "The FIRST image is an illustrated avatar portrait — study this person's "
        "face, hair style, hair colour, skin tone, and facial features carefully. "
        f"The next {len(garment_bytes_list)} image(s) are clothing items: {outfit_desc}. "
        "Generate a single full-body illustrated image of the SAME character from the "
        "first image wearing ALL of the clothing items shown. "
        "Preserve the character's face, hair and skin tone exactly as in the portrait. "
        "Show every garment item clearly. "
        "Full body, head to toe, forward-facing pose. "
        "Same illustration style as the portrait. Plain off-white background."
    )

    parts: list = [genai_types.Part.from_text(text=prompt)]
    parts.append(genai_types.Part.from_bytes(data=avatar_bytes, mime_type="image/jpeg"))
    for gb in garment_bytes_list:
        parts.append(genai_types.Part.from_bytes(data=gb, mime_type="image/jpeg"))

    logger.info(
        "outfit_on_avatar[gemini]: calling model=%s garments=%d",
        model,
        len(garment_bytes_list),
    )

    try:
        response = await asyncio.to_thread(
            client.models.generate_content,
            model=model,
            contents=parts,
            config=genai_types.GenerateContentConfig(
                response_modalities=["IMAGE", "TEXT"],
                temperature=1.0,
            ),
        )
    except Exception as exc:
        logger.warning("outfit_on_avatar[gemini]: Gemini call failed: %s", exc)
        return None

    for candidate in getattr(response, "candidates", None) or []:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", None) or []:
            inline = getattr(part, "inline_data", None)
            if inline and getattr(inline, "data", None):
                raw = inline.data
                logger.info(
                    "outfit_on_avatar[gemini]: returned image bytes=%d", len(raw)
                )
                try:
                    return _to_jpeg(raw)
                except Exception:
                    return raw  # type: ignore[return-value]

    logger.warning("outfit_on_avatar[gemini]: Gemini returned no image in response")
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def generate_outfit_on_avatar(
    avatar_url: str,
    garment_items: Sequence[dict],
) -> bytes:
    """
    Generate a JPEG image of the user's avatar wearing the recommended outfit.

    Tries three strategies in order:
    1. Imagen 3 personalized generation  (avatar as person reference)
    2. Gemini 2.0 Flash multimodal image generation
    3. PIL side-by-side composite          (always succeeds)

    Args:
        avatar_url:     Public URL of the stored avatar portrait.
        garment_items:  Ordered list of dicts with keys ``url``, ``name``,
                        ``category``.

    Returns:
        JPEG bytes of the generated / composited image.
    """
    async with httpx.AsyncClient() as client:
        tasks = [_fetch_bytes(avatar_url, client)] + [
            _fetch_bytes((item.get("url") or "").strip(), client)
            for item in garment_items
        ]
        results = await asyncio.gather(*tasks)

    avatar_raw = results[0]
    garment_raws: list[bytes | None] = list(results[1:])

    if not avatar_raw:
        raise RuntimeError("Could not fetch the avatar portrait image.")

    avatar_jpeg = _to_jpeg(avatar_raw)

    garment_jpeg_list: list[bytes] = []
    for raw in garment_raws:
        if raw:
            try:
                garment_jpeg_list.append(_to_jpeg(raw))
            except Exception:
                pass

    # Strategy 1: Imagen personalized generation
    result = await _imagen_outfit(avatar_jpeg, garment_items)
    if result:
        return result

    # Strategy 2: Gemini multimodal image generation
    if garment_jpeg_list:
        result = await _gemini_outfit(avatar_jpeg, garment_jpeg_list, garment_items)
        if result:
            return result

    # Strategy 3: PIL composite fallback
    logger.info("outfit_on_avatar: all AI strategies failed — falling back to PIL composite")
    from .outfit_composite import build_outfit_composite
    return await build_outfit_composite(
        avatar_url=avatar_url,
        garment_items=list(garment_items),
    )
