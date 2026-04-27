"""
routers/avatar_router.py — Avatar portrait generation + outfit-preview endpoints.

POST /users/{user_id}/avatar/generate
    Accepts a selfie image (multipart/form-data), generates a stylised 2-D
    portrait using Gemini Vision + Imagen/FLUX, stores the result, and
    updates the user's avatar_config.avatar_image_url.

POST /users/{user_id}/outfit-preview/generate
    Uses Gemini multimodal image generation to produce an image of the user's
    avatar *wearing* the recommended outfit.  Falls back to PIL compositing
    if Gemini is unavailable.
"""

from __future__ import annotations

import io
import logging

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from PIL import Image

from ..avatar_gen import generate_avatar_image
from ..db import (
    get_outfit_preview_url,
    get_user_profile,
    store_avatar_image,
    store_outfit_preview_image,
    upsert_user_profile,
)
from ..models import AvatarConfig
from ..outfit_on_avatar import generate_outfit_on_avatar

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["avatar"])

_ALLOWED_TRUSTED_MIME = frozenset(
    {"image/jpeg", "image/jpg", "image/png", "image/heic", "image/heif", "image/webp"}
)
_MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15 MB

# Pillow ``Image.format`` → canonical MIME (validated against _ALLOWED_TRUSTED_MIME).
_PIL_FORMAT_TO_MIME: dict[str, str] = {
    "JPEG": "image/jpeg",
    "MPO": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
    "HEIF": "image/heic",
    "HEIC": "image/heic",
}


class AvatarGenerateResponse(BaseModel):
    avatar_image_url: str


class GarmentImageItem(BaseModel):
    url: str
    """Public URL of the garment's photo (``primaryImageUrl``)."""
    name: str
    """Garment display name."""
    category: str
    """Garment category: top | bottom | dress | outerwear | shoes | accessory."""


class OutfitPreviewRequest(BaseModel):
    outfit_id: str
    """Stable ID used as the cache key — typically ``DayRecommendation.outfit.id``."""
    avatar_image_url: str
    """Public URL of the user's stored avatar portrait."""
    garment_images: list[GarmentImageItem]
    """Ordered list of garment images to include (outerwear → top → bottom → shoes → accessory)."""


class OutfitPreviewResponse(BaseModel):
    preview_image_url: str


def _trusted_mime_from_image_bytes(data: bytes) -> str:
    """
    Decode *data* with Pillow and return a MIME type derived from the actual
    payload — do not trust the client ``Content-Type`` header.
    """
    if not data:
        raise ValueError("Selfie file is empty.")
    try:
        with Image.open(io.BytesIO(data)) as im:
            im.load()
            fmt = (im.format or "").upper()
    except Exception as exc:
        raise ValueError("Could not decode image bytes; upload a valid JPEG, PNG, WebP, or HEIC.") from exc

    mime = _PIL_FORMAT_TO_MIME.get(fmt)
    if mime is None or mime not in _ALLOWED_TRUSTED_MIME:
        raise ValueError(f"Unsupported image type after decode (format={fmt or 'unknown'}).")
    if mime == "image/jpg":
        mime = "image/jpeg"
    return mime


@router.post("/{user_id}/avatar/generate", response_model=AvatarGenerateResponse)
async def generate_avatar(
    user_id: str,
    selfie: UploadFile = File(..., description="Selfie photo (JPEG/PNG/HEIC, max 15 MB)"),
) -> AvatarGenerateResponse:
    """
    Generate a stylised 2-D portrait avatar from the uploaded selfie.

    **Flow**

    1. Read bytes, enforce size, **sniff** format with Pillow (ignore client ``Content-Type``).
    2. Load the user's profile to obtain avatar config and colour tone.
    3. Pass the selfie bytes to the two-step pipeline in ``backend.avatar_gen``:
       - Gemini Vision extracts a facial-feature description (best-effort).
       - Imagen / FLUX generates the illustrated portrait from that description
         combined with the user's avatar config preferences.
    4. Store the resulting JPEG in Supabase Storage (or local filesystem in dev).
    5. Update ``user_profiles.avatar_config.avatar_image_url`` and return the URL.

    The raw selfie is **never stored** — it is used only in-memory during the
    request and discarded immediately after generation.
    """
    selfie_bytes = await selfie.read()
    if not selfie_bytes:
        raise HTTPException(status_code=400, detail="Selfie file is empty.")
    if len(selfie_bytes) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Selfie exceeds the {_MAX_UPLOAD_BYTES // 1024 // 1024} MB size limit.",
        )

    try:
        mime = _trusted_mime_from_image_bytes(selfie_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    profile = get_user_profile(user_id)
    avatar_config: AvatarConfig = (
        profile.avatar_config if profile and profile.avatar_config else AvatarConfig()
    )
    color_tone: str | None = profile.color_tone if profile else None
    profile_gender: str | None = profile.gender if profile else None

    logger.info(
        "avatar_router: generating avatar for user_id=%s selfie_bytes=%d mime=%s",
        user_id,
        len(selfie_bytes),
        mime,
    )
    try:
        jpeg_bytes = await generate_avatar_image(
            selfie_bytes=selfie_bytes,
            selfie_mime=mime,
            avatar_config=avatar_config,
            color_tone=color_tone,
            gender=profile_gender,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        logger.exception("avatar generation failed for user_id=%s", user_id)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    try:
        avatar_url = store_avatar_image(user_id, jpeg_bytes)
    except Exception:
        logger.exception("avatar storage failed for user_id=%s", user_id)
        raise HTTPException(status_code=500, detail="Failed to store the generated avatar.") from exc

    updated_config = AvatarConfig(
        hair_style=avatar_config.hair_style,
        hair_color=avatar_config.hair_color,
        body_type=avatar_config.body_type,
        skin_tone=avatar_config.skin_tone,
        avatar_image_url=avatar_url,
    )
    upsert_user_profile(user_id, {"avatar_config": updated_config})

    logger.info("avatar_router: avatar saved url=%s", avatar_url)
    return AvatarGenerateResponse(avatar_image_url=avatar_url)


@router.post("/{user_id}/outfit-preview/generate", response_model=OutfitPreviewResponse)
async def generate_outfit_preview(
    user_id: str,
    body: OutfitPreviewRequest,
) -> OutfitPreviewResponse:
    """
    Generate (or return a cached) outfit preview showing the user's avatar
    **wearing** the recommended outfit items.

    **Flow**

    1. Check whether a preview for this ``(user_id, outfit_id)`` pair is already
       stored — return it immediately if so (no network call).
    2. Call ``generate_outfit_on_avatar``:
       - Downloads the avatar portrait and garment photos.
       - Sends them to Gemini multimodal image generation with a prompt asking
         it to redraw the same character dressed in those specific clothes.
       - Falls back to PIL side-by-side compositing if Gemini is unavailable.
    3. Store the JPEG and return the URL.
    """
    if not body.outfit_id.strip():
        raise HTTPException(status_code=422, detail="outfit_id must not be empty.")
    if not body.avatar_image_url.strip():
        raise HTTPException(status_code=422, detail="avatar_image_url must not be empty.")

    # Return the cached composite if it already exists.
    cached_url = get_outfit_preview_url(user_id, body.outfit_id)
    if cached_url:
        logger.info(
            "avatar_router: outfit preview cache hit user_id=%s outfit_id=%s",
            user_id,
            body.outfit_id,
        )
        return OutfitPreviewResponse(preview_image_url=cached_url)

    logger.info(
        "avatar_router: generating outfit-on-avatar preview user_id=%s outfit_id=%s garments=%d",
        user_id,
        body.outfit_id,
        len(body.garment_images),
    )

    garment_dicts = [
        {"url": g.url, "name": g.name, "category": g.category}
        for g in body.garment_images
        if g.url.strip()
    ]

    try:
        jpeg_bytes = await generate_outfit_on_avatar(
            avatar_url=body.avatar_image_url,
            garment_items=garment_dicts,
        )
    except Exception as exc:
        logger.exception("outfit_on_avatar failed for user_id=%s", user_id)
        raise HTTPException(
            status_code=502,
            detail=f"Failed to generate outfit preview: {exc}",
        ) from exc

    try:
        preview_url = store_outfit_preview_image(user_id, body.outfit_id, jpeg_bytes)
    except Exception:
        logger.exception("outfit preview storage failed user_id=%s", user_id)
        raise HTTPException(status_code=500, detail="Failed to store the generated outfit preview.") from None

    logger.info("avatar_router: outfit preview saved url=%s", preview_url)
    return OutfitPreviewResponse(preview_image_url=preview_url)
