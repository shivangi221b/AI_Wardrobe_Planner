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

_MAX_SELFIE_BYTES = 15 * 1024 * 1024  # 15 MB sanity cap


def _avatar_vision_model() -> str:
    """
    Gemini model for selfie → facial description (Vertex AI).

    Uses only ``VERTEX_AI_VISION_MODEL`` — same variable as ``vision/extractor.py``
    for garment vision. If unset, defaults to ``gemini-2.5-flash``.
    """
    return (os.getenv("VERTEX_AI_VISION_MODEL") or "gemini-2.5-flash").strip()

_FEATURE_EXTRACTION_PROMPT = (
    "You are helping build an illustrated avatar from a selfie. Study the face and head closely.\n\n"
    "Write a detailed, factual description in plain prose. Aim for roughly 150–400 words. "
    "Cover everything clearly visible:\n"
    "• Face shape, overall proportions, forehead height, cheek volume.\n"
    "• Eyebrows: thickness, arch, distance from eyes.\n"
    "• Eyes: shape, size, spacing, eyelid shape, visible iris colour if discernible, under-eye area.\n"
    "• Nose: bridge width, length, tip shape, nostril visibility.\n"
    "• Mouth and lips: width, upper/lower lip fullness, resting expression.\n"
    "• Jaw, chin, and neck (if visible): angles, width, chin shape.\n"
    "• Ears: only if visible — size, angle, prominence.\n"
    "• Skin: tone and undertone hints, texture or sheen (neutral, observational wording).\n"
    "• Facial hair: clean-shaven, stubble, beard, or mustache — coverage, shape, density.\n"
    "• Hair: hairline, density, length, how it falls, colour (including gray if visible).\n"
    "• Face-framing accessories: glasses, hat brim, etc., if present.\n"
    "• Approximate apparent age band (e.g. late twenties, forties) — structural only.\n\n"
    "Rules: Use neutral structural language. Do not name the person or guess their identity, "
    "job, or ethnicity labels. Do not describe clothing below the collar or the background. "
    "Do not refuse; describe only what you can see."
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


def _text_from_generate_content_response(response: genai_types.GenerateContentResponse) -> str:
    """Aggregate visible text from a Gemini response (``response.text`` can be empty on 2.5 models)."""
    direct = (getattr(response, "text", None) or "").strip()
    if direct:
        return direct
    parts_out: list[str] = []
    for cand in getattr(response, "candidates", None) or []:
        content = getattr(cand, "content", None)
        for part in getattr(content, "parts", None) or []:
            t = getattr(part, "text", None)
            if t:
                parts_out.append(t)
        break
    return " ".join(parts_out).strip()


async def _describe_selfie(selfie_bytes: bytes, mime_type: str) -> Optional[str]:
    """
    Send the selfie to Gemini Vision and return a short facial-feature
    description string, or ``None`` if Gemini is unavailable or the call fails.
    """
    client = _gemini_client()
    if client is None:
        logger.info("avatar_gen: GOOGLE_CLOUD_PROJECT not set — skipping Gemini selfie analysis")
        return None

    # Instruction first, then image — matches ``vision/extractor.py`` and improves adherence.
    text_part = genai_types.Part.from_text(text=_FEATURE_EXTRACTION_PROMPT)
    image_part = genai_types.Part.from_bytes(data=selfie_bytes, mime_type=mime_type)

    model = _avatar_vision_model()
    cfg_kw: dict = {"max_output_tokens": 4096, "temperature": 0.25}
    if "2.5" in model:
        cfg_kw["thinking_config"] = genai_types.ThinkingConfig(thinking_budget=0)
    cfg = genai_types.GenerateContentConfig(**cfg_kw)
    try:
        response = await asyncio.to_thread(
            client.models.generate_content,
            model=model,
            contents=[text_part, image_part],
            config=cfg,
        )
        description = _text_from_generate_content_response(response)
        if not description:
            pf = getattr(response, "prompt_feedback", None)
            block = getattr(pf, "block_reason", None) if pf else None
            c0 = (getattr(response, "candidates", None) or [None])[0]
            finish = getattr(c0, "finish_reason", None) if c0 else None
            logger.warning(
                "avatar_gen: Gemini selfie returned empty text model=%s block_reason=%s finish_reason=%s",
                model,
                block,
                finish,
            )
        else:
            logger.info(
                "avatar_gen: Gemini selfie OK model=%s description_len=%d",
                model,
                len(description),
            )
        return description if description else None
    except Exception as exc:
        logger.warning(
            "avatar_gen: Gemini selfie analysis failed model=%s: %s",
            model,
            exc,
        )
        return None


# ---------------------------------------------------------------------------
# Step 2 — Prompt construction
# ---------------------------------------------------------------------------

def _primary_subject_line(gender: Optional[str]) -> str:
    """First tokens in the image prompt — models weight the beginning heavily."""
    g = (gender or "").strip().lower()
    if g == "male":
        return (
            "Illustrated head-and-shoulders portrait of exactly one adult man, "
            "character illustration with soft shading, plain off-white background, not a photograph."
        )
    if g == "female":
        return (
            "Illustrated head-and-shoulders portrait of exactly one adult woman, "
            "character illustration with soft shading, plain off-white background, not a photograph."
        )
    if g == "other":
        return (
            "Illustrated head-and-shoulders portrait of exactly one adult person, "
            "inclusive non-stereotypical look, character illustration with soft shading, "
            "plain off-white background, not a photograph."
        )
    return (
        "Illustrated head-and-shoulders portrait of exactly one adult person matching the facial "
        "description below, character illustration with soft shading, plain off-white background, "
        "not a photograph."
    )


def _anti_stock_clause(gender: Optional[str]) -> str:
    g = (gender or "").strip().lower()
    base = (
        "A single distinctive individual with natural asymmetry; "
        "avoid generic stock clipart, corporate vector templates, beauty-app default faces, "
        "and symmetrical influencer glam."
    )
    if g == "male":
        return (
            base
            + " No red lipstick, no winged eyeliner, no glamour makeup or long feminine lashes "
            "unless clearly matching the reference description."
        )
    return base


def _subject_gender_clause(gender: Optional[str]) -> Optional[str]:
    """
    Strong gender anchor for the portrait — without this, image models often default
    to a feminine-presenting illustration regardless of the reference description.
    """
    if not gender:
        return None
    g = str(gender).strip().lower()
    if g == "male":
        return (
            "Portrait subject is an adult male: keep masculine facial structure, jaw, and brow; "
            "short or styled male-typical hair unless the hair description below says otherwise; "
            "do not render as female or feminine-presenting."
        )
    if g == "female":
        return (
            "Portrait subject is an adult female: keep feminine facial structure; "
            "do not render as male or masculine-presenting unless the description clearly indicates otherwise."
        )
    if g == "other":
        return (
            "Portrait subject is an adult with inclusive, non-stereotypical or androgynous presentation; "
            "avoid defaulting to hyper-feminine or hyper-masculine stock character looks."
        )
    return None


def _build_avatar_prompt(
    facial_description: Optional[str],
    avatar_config: Optional[AvatarConfig],
    color_tone: Optional[str],
    gender: Optional[str] = None,
    outfit_description: Optional[str] = None,
) -> str:
    """
    Assemble a Imagen-safe prompt for a stylised portrait illustration.

    The prompt explicitly requests an *illustration* (not a photograph) so
    Imagen's real-person content policy is not triggered.

    When ``outfit_description`` is provided the prompt shifts to a full-body
    illustration showing the character wearing that outfit.
    """
    cfg = avatar_config or AvatarConfig()

    if outfit_description:
        # Full-body framing so the outfit is visible
        subject_line = _primary_subject_line(gender).replace(
            "head-and-shoulders portrait",
            "full-body illustrated portrait",
        )
    else:
        subject_line = _primary_subject_line(gender)

    # Put the Gemini face description immediately after the subject line so T2I models
    # weight it heavily (and so truncation, if any, drops style boilerplate last).
    lines: list[str] = [subject_line]

    if facial_description:
        lines.append(
            "PRIMARY facial reference from the user's photo — the illustration MUST reflect these "
            f"traits (interpret as stylised art, not a photo): {facial_description}"
        )

    gender_clause = _subject_gender_clause(gender)
    if gender_clause:
        lines.append(gender_clause)
    else:
        lines.append(
            "Match apparent gender presentation and age from the facial description only; "
            "do not substitute a different gender presentation."
        )

    # Explicit avatar config (reinforces hair/body when the user set preferences)
    if cfg.skin_tone:
        lines.append(f"User skin tone preference for the illustration: {cfg.skin_tone.replace('_', ' ')}.")
    if cfg.hair_style and cfg.hair_color:
        lines.append(
            f"User hair preference: {cfg.hair_color.replace('_', ' ')} colour, "
            f"{cfg.hair_style.replace('_', ' ')} style — align with the photo description when both apply."
        )
    elif cfg.hair_style:
        lines.append(f"User hair style preference: {cfg.hair_style.replace('_', ' ')}.")
    elif cfg.hair_color:
        lines.append(f"User hair colour preference: {cfg.hair_color.replace('_', ' ')}.")
    if cfg.body_type:
        lines.append(f"Body type: {cfg.body_type} build.")

    tone = (color_tone or "").strip().lower()
    if tone in ("warm", "cool", "neutral"):
        lines.append(f"Overall colour palette: {tone} tones.")

    if outfit_description:
        lines.append(
            f"The character is wearing the following outfit — render each garment clearly and accurately: {outfit_description}."
        )
        lines.append(
            "Show the complete outfit from head to toe. Clothing details must be prominent and recognisable."
        )

    lines.append(_anti_stock_clause(gender))

    if outfit_description:
        lines.append("Full-body upright pose, plain off-white background, single character only.")
    else:
        lines.append("Square crop, centred composition, single face only.")

    return " ".join(lines)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def generate_avatar_image(
    selfie_bytes: Optional[bytes],
    selfie_mime: str = "image/jpeg",
    avatar_config: Optional[AvatarConfig] = None,
    color_tone: Optional[str] = None,
    gender: Optional[str] = None,
    outfit_description: Optional[str] = None,
) -> bytes:
    """
    Generate a stylised 2-D portrait avatar image and return JPEG bytes.

    Args:
        selfie_bytes:       Raw image bytes of the user's selfie.  May be ``None``
                            when generating an outfit preview without a selfie (the
                            Gemini facial-feature step is skipped in that case).
        selfie_mime:        MIME type, e.g. ``"image/jpeg"`` or ``"image/png"``.
        avatar_config:      Structured avatar preferences (hair, skin tone, body type).
        color_tone:         ``"warm"``, ``"cool"``, or ``"neutral"`` — from the user profile.
        gender:             ``"male"``, ``"female"``, or ``"other"`` from the user profile — strongly
                            influences portrait gender presentation so the output matches the user.
        outfit_description: Optional free-text description of the outfit to render on the
                            avatar (e.g. ``"navy blazer, white shirt, grey chinos, brown oxfords"``).
                            When set the prompt shifts to a full-body illustration.

    Returns:
        JPEG bytes of the generated portrait (square, 512 × 512 by default).

    Raises:
        RuntimeError: If both Gemini and the image-generation backend fail.
    """
    if selfie_bytes is not None and len(selfie_bytes) > _MAX_SELFIE_BYTES:
        raise ValueError(
            f"Selfie exceeds the {_MAX_SELFIE_BYTES // 1024 // 1024} MB size limit."
        )

    # Step 1 — extract facial features via Gemini Vision (best-effort, skipped for outfit previews)
    facial_description: Optional[str] = None
    if selfie_bytes:
        facial_description = await _describe_selfie(selfie_bytes, selfie_mime)

    # Step 2 — build Imagen prompt
    prompt = _build_avatar_prompt(
        facial_description,
        avatar_config,
        color_tone,
        gender=gender,
        outfit_description=outfit_description,
    )
    logger.info(
        "avatar_gen: prompt length=%d gender=%r has_outfit=%r",
        len(prompt),
        gender,
        outfit_description is not None,
    )
    # Never log prompt text by default — it embeds the user's selfie-derived facial description (PII).
    if os.getenv("AVATAR_LOG_PROMPT_PREVIEW", "").strip().lower() in ("1", "true", "yes"):
        logger.info(
            "avatar_gen: prompt preview (AVATAR_LOG_PROMPT_PREVIEW enabled): %s",
            prompt[:480] + ("…" if len(prompt) > 480 else ""),
        )

    # Step 3 — generate image (avatars use their own provider selection; see generate_avatar_portrait_image)
    from vision.image_gen import generate_avatar_portrait_image  # local import to avoid circular

    jpeg_bytes: bytes = await asyncio.to_thread(generate_avatar_portrait_image, prompt)
    return jpeg_bytes
