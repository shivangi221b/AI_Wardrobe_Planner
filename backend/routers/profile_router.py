"""
routers/profile_router.py — User style-profile endpoints.

GET  /users/{user_id}/profile  — fetch the user's extended profile.
PUT  /users/{user_id}/profile  — create or partially update the profile.
"""

from __future__ import annotations

from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import get_user_profile, upsert_user_profile
from ..models import AvatarConfig, UserProfile

router = APIRouter(prefix="/users", tags=["profile"])


# ---------------------------------------------------------------------------
# Request / response bodies
# ---------------------------------------------------------------------------


class AvatarConfigBody(BaseModel):
    hair_style: Optional[str] = None
    hair_color: Optional[str] = None
    body_type: Optional[str] = None
    skin_tone: Optional[str] = None


class UserProfileBody(BaseModel):
    """
    Partial update body for ``PUT /users/{user_id}/profile``.

    All fields are optional so that callers can update any subset without
    knowing the full current state.
    """

    gender: Optional[str] = None
    birthday: Optional[str] = None
    skin_tone: Optional[str] = None
    color_tone: Optional[str] = None
    favorite_colors: Optional[List[str]] = None
    avoided_colors: Optional[List[str]] = None
    shoe_size: Optional[str] = None
    top_size: Optional[str] = None
    bottom_size: Optional[str] = None
    avatar_config: Optional[AvatarConfigBody] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/{user_id}/profile", response_model=UserProfile)
async def get_profile(user_id: str) -> UserProfile:
    """
    Return the extended style profile for *user_id*.

    Returns ``404`` when the profile has never been saved (e.g. users who
    signed up before this feature was deployed).
    """
    profile = get_user_profile(user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile


@router.put("/{user_id}/profile", response_model=UserProfile)
async def update_profile(user_id: str, body: UserProfileBody) -> UserProfile:
    """
    Create or partially update the extended style profile for *user_id*.

    Only explicitly provided (non-``null``) fields are written; omitted fields
    are not touched on existing profiles.
    """
    data: dict[str, Any] = {}

    for field in ("gender", "birthday", "skin_tone", "color_tone", "shoe_size", "top_size", "bottom_size"):
        value = getattr(body, field)
        if value is not None:
            data[field] = value

    if body.favorite_colors is not None:
        data["favorite_colors"] = body.favorite_colors
    if body.avoided_colors is not None:
        data["avoided_colors"] = body.avoided_colors

    if body.avatar_config is not None:
        data["avatar_config"] = AvatarConfig(
            hair_style=body.avatar_config.hair_style,
            hair_color=body.avatar_config.hair_color,
            body_type=body.avatar_config.body_type,
            skin_tone=body.avatar_config.skin_tone,
        )

    return upsert_user_profile(user_id, data)
