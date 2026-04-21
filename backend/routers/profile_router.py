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

    **Omitted vs explicit null**:  Pydantic records which fields were actually
    supplied in the request via ``model_fields_set``.  The endpoint uses this
    to distinguish "caller didn't mention the field" (leave unchanged) from
    "caller explicitly sent ``null``" (clear the stored value).
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

    Only fields **present in the request body** are written.  Omitted fields
    are left unchanged on existing profiles.  Explicitly sending ``null``
    clears the stored value (e.g. ``{"skin_tone": null}`` removes the tone
    preference).
    """
    data: dict[str, Any] = {}

    # Scalar / list fields — write only when the caller explicitly provided them
    # (whether the value is a string, a list, or null).
    for field in (
        "gender", "birthday", "skin_tone", "color_tone",
        "shoe_size", "top_size", "bottom_size",
        "favorite_colors", "avoided_colors",
    ):
        if field in body.model_fields_set:
            data[field] = getattr(body, field)

    # avatar_config: null clears it; an object merges individual sub-fields.
    if "avatar_config" in body.model_fields_set:
        if body.avatar_config is None:
            data["avatar_config"] = None
        else:
            av = body.avatar_config
            data["avatar_config"] = AvatarConfig(
                hair_style=av.hair_style,
                hair_color=av.hair_color,
                body_type=av.body_type,
                skin_tone=av.skin_tone,
            )

    return upsert_user_profile(user_id, data)
