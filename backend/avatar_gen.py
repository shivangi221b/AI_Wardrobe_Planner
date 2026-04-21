"""
avatar_gen.py — AI-powered avatar portrait generation.

Two-step pipeline:

1. **Gemini Vision** — analyses the selfie bytes and returns a compact text
   description of the person's facial/physical features (face shape, eye
   colour, skin nuances, etc.).  This avoids passing a real-person photo
   directly into Imagen, keeping the generation well within content-policy
   bounds.

2. **Imagen / FLUX** (via ``vision.image_gen``) — generates a stylised,
   flat-design portrait illustration from a prompt that combines the Gemini
   facial description with the user's explicit avatar config (hair style, hair
   colour, body type, skin tone, colour tone).

If ``GOOGLE_CLOUD_PROJECT`` is not set the Gemini step is skipped and the
prompt is built from the avatar config fields alone, still producing a
personalised illustration.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional

from google import genai
from google.genai import types as genai_types

from .models import AvatarConfig

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_VISION_MODEL = os.getenv("AVATAR_VISION_MODEL", "gemini-2.0-flash-001")
_MAX_SELFIE_BYTES = 15 * 1024 * 1024  # 15 MB sanity cap

_FEATURE_EXTRACTION_PROMPT = (
    "Look at this photo of a real person and describe only their physical appearance "
    "in a single compact sentence (max 60 words). Focus on: face shape, eye shape and "
    "colour, skin tone nuance, and any other distinctive features. "
    "Do NOT include their name, gender, clothing, or background. "
    "Do NOT say 'I cannot' — describe only what you can observe."
)


# ---------------------------------------------------------------------------
# Gemini client — lazily initialised (shared with llm.py pattern)
# ---------------------------------------------------------------------------

def _gemini_client() -> Optional[genai.Client]:
    project = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    if not project:
        return None
    location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
    return genai.Client(vertexai=True, project=project, location=location)


# ---------------------------------------------------------------------------
# Step 1 — Gemini Vision: selfie → facial feature description
# ---------------------------------------------------------------------------

async def _describe_selfie(selfie_bytes: bytes, mime_type: str) -> Optional[str]:
    """
    Send the selfie to Gemini Vision and return a short facial-feature
    description string, or ``None`` if Gemini is unavailable or the call fails.
    """
    client = _gemini_client()
    if client is None:
        logger.info("avatar_gen: GOOGLE_CLOUD_PROJECT not set — skipping Gemini selfie analysis")
        return None

    image_part = genai_types.Part.from_bytes(data=selfie_bytes, mime_type=mime_type)
    text_part = genai_types.Part.from_text(text=_FEATURE_EXTRACTION_PROMPT)

    try:
        response = await asyncio.to_thread(
            client.models.generate_content,
            model=_VISION_MODEL,
            contents=[image_part, text_part],
            config=genai_types.GenerateContentConfig(
                max_output_tokens=100,
                temperature=0.2,
            ),
        )
        description = (response.text or "").strip()
        logger.info("avatar_gen: Gemini selfie description length=%d", len(description))
        return description if description else None
    except Exception as exc:
        logger.warning("avatar_gen: Gemini selfie analysis failed: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Step 2 — Prompt construction
# ---------------------------------------------------------------------------

def _build_avatar_prompt(
    facial_description: Optional[str],
    avatar_config: Optional[AvatarConfig],
    color_tone: Optional[str],
) -> str:
    """
    Assemble a Imagen-safe prompt for a stylised portrait illustration.

    The prompt explicitly requests an *illustration* (not a photograph) so
    Imagen's real-person content policy is not triggered.
    """
    cfg = avatar_config or AvatarConfig()

    lines: list[str] = [
        "A stylised, flat-design fashion-app profile illustration of a person.",
        "Clean vector art style with soft shading, neutral off-white background.",
        "NOT a photograph. NOT a realistic render. Illustrated portrait, head and shoulders.",
    ]

    # Facial features from selfie analysis
    if facial_description:
        lines.append(f"Facial features reference (illustrated): {facial_description}.")

    # Explicit avatar config
    if cfg.skin_tone:
        lines.append(f"Skin tone: {cfg.skin_tone.replace('_', ' ')}.")
    if cfg.hair_style and cfg.hair_color:
        lines.append(f"Hair: {cfg.hair_color.replace('_', ' ')} coloured, {cfg.hair_style.replace('_', ' ')} style.")
    elif cfg.hair_style:
        lines.append(f"Hair style: {cfg.hair_style.replace('_', ' ')}.")
    elif cfg.hair_color:
        lines.append(f"Hair colour: {cfg.hair_color.replace('_', ' ')}.")
    if cfg.body_type:
        lines.append(f"Body type: {cfg.body_type} build.")

    # Colour tone / palette
    tone = (color_tone or "").strip().lower()
    if tone in ("warm", "cool", "neutral"):
        lines.append(f"Overall colour palette: {tone} tones.")

    lines.append("Fashion-forward, modern aesthetic. Square crop, centred composition.")

    return " ".join(lines)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def generate_avatar_image(
    selfie_bytes: bytes,
    selfie_mime: str,
    avatar_config: Optional[AvatarConfig] = None,
    color_tone: Optional[str] = None,
) -> bytes:
    """
    Generate a stylised 2-D portrait avatar image and return JPEG bytes.

    Args:
        selfie_bytes:  Raw image bytes of the user's selfie.
        selfie_mime:   MIME type, e.g. ``"image/jpeg"`` or ``"image/png"``.
        avatar_config: Structured avatar preferences (hair, skin tone, body type).
        color_tone:    ``"warm"``, ``"cool"``, or ``"neutral"`` — from the user profile.

    Returns:
        JPEG bytes of the generated portrait (square, 512 × 512 by default).

    Raises:
        RuntimeError: If both Gemini and the image-generation backend fail.
    """
    if len(selfie_bytes) > _MAX_SELFIE_BYTES:
        raise ValueError(
            f"Selfie exceeds the {_MAX_SELFIE_BYTES // 1024 // 1024} MB size limit."
        )

    # Step 1 — extract facial features via Gemini Vision (best-effort)
    facial_description = await _describe_selfie(selfie_bytes, selfie_mime)

    # Step 2 — build Imagen prompt
    prompt = _build_avatar_prompt(facial_description, avatar_config, color_tone)
    logger.info("avatar_gen: prompt length=%d", len(prompt))

    # Step 3 — generate image (runs sync code in thread pool to avoid blocking)
    from vision.image_gen import generate_garment_image  # local import to avoid circular

    jpeg_bytes: bytes = await asyncio.to_thread(generate_garment_image, prompt)
    return jpeg_bytes
