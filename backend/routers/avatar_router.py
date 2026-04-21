"""
routers/avatar_router.py — Avatar portrait generation endpoint.

POST /users/{user_id}/avatar/generate
    Accepts a selfie image (multipart/form-data), generates a stylised 2-D
    portrait using Gemini Vision + Imagen/FLUX, stores the result, and
    updates the user's avatar_config.avatar_image_url.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

from ..avatar_gen import generate_avatar_image
from ..db import get_user_profile, store_avatar_image, upsert_user_profile
from ..models import AvatarConfig

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["avatar"])

_ALLOWED_MIME_TYPES = frozenset(
    {"image/jpeg", "image/jpg", "image/png", "image/heic", "image/heif", "image/webp"}
)
_MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15 MB


class AvatarGenerateResponse(BaseModel):
    avatar_image_url: str


@router.post("/{user_id}/avatar/generate", response_model=AvatarGenerateResponse)
async def generate_avatar(
    user_id: str,
    selfie: UploadFile = File(..., description="Selfie photo (JPEG/PNG/HEIC, max 15 MB)"),
) -> AvatarGenerateResponse:
    """
    Generate a stylised 2-D portrait avatar from the uploaded selfie.

    **Flow**

    1. Validate the selfie file type and size.
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
    # --- Validate MIME type ---
    mime = (selfie.content_type or "").lower().split(";")[0].strip()
    if mime not in _ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{mime}'. Upload a JPEG, PNG, HEIC, or WebP photo.",
        )

    # --- Read and size-check the selfie ---
    selfie_bytes = await selfie.read()
    if len(selfie_bytes) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Selfie exceeds the {_MAX_UPLOAD_BYTES // 1024 // 1024} MB size limit.",
        )
    if not selfie_bytes:
        raise HTTPException(status_code=400, detail="Selfie file is empty.")

    # --- Load user profile (avatar config + colour tone) ---
    profile = get_user_profile(user_id)
    avatar_config: AvatarConfig = (
        profile.avatar_config if profile and profile.avatar_config else AvatarConfig()
    )
    color_tone: str | None = profile.color_tone if profile else None

    # --- Generate the portrait ---
    logger.info(
        "avatar_router: generating avatar for user_id=%s selfie_bytes=%d",
        user_id,
        len(selfie_bytes),
    )
    try:
        jpeg_bytes = await generate_avatar_image(
            selfie_bytes=selfie_bytes,
            selfie_mime=mime,
            avatar_config=avatar_config,
            color_tone=color_tone,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        logger.exception("avatar generation failed for user_id=%s", user_id)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    # --- Persist the generated image ---
    try:
        avatar_url = store_avatar_image(user_id, jpeg_bytes)
    except Exception as exc:
        logger.exception("avatar storage failed for user_id=%s", user_id)
        raise HTTPException(status_code=500, detail="Failed to store the generated avatar.") from exc

    # --- Update the profile with the new URL ---
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
