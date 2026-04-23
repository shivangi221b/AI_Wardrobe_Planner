"""
Wear-tracking & laundry-status endpoints.

Provides routes for logging wear events, toggling laundry status,
querying wear/outfit history, and fetching wardrobe usage insights.
"""

from __future__ import annotations

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from ..db import (
    get_garment_insights,
    get_outfit_log,
    get_wear_history,
    log_outfit,
    log_wear_event,
    set_laundry_status,
)
from ..models import (
    GarmentInsights,
    LogOutfitRequest,
    LogWearRequest,
    OutfitLogEntry,
    SetLaundryRequest,
    WearLogEntry,
)

router = APIRouter()


@router.post("/wardrobe/{user_id}/{garment_id}/wear", response_model=WearLogEntry)
async def wear_garment(user_id: str, garment_id: str, body: LogWearRequest | None = None):
    """Log that a garment was worn on a given date (defaults to today)."""
    worn_date = (body.worn_date if body and body.worn_date else None) or date.today()
    entry = log_wear_event(user_id, garment_id, worn_date)
    if entry is None:
        raise HTTPException(status_code=500, detail="Failed to log wear event.")
    return entry


@router.patch("/wardrobe/{user_id}/{garment_id}/laundry")
async def update_laundry_status(user_id: str, garment_id: str, body: SetLaundryRequest):
    """Set the laundry status of a garment (clean / in_laundry)."""
    updated = set_laundry_status(user_id, garment_id, body.status)
    if updated is None:
        raise HTTPException(status_code=404, detail="Garment not found.")
    return updated


@router.get("/users/{user_id}/wear-history", response_model=List[WearLogEntry])
async def read_wear_history(
    user_id: str,
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
):
    """Return per-garment wear log entries, optionally filtered by date range."""
    return get_wear_history(user_id, start, end)


@router.get("/users/{user_id}/outfit-log", response_model=List[OutfitLogEntry])
async def read_outfit_log(
    user_id: str,
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
):
    """Return outfit log entries (full outfits), optionally filtered by date range."""
    return get_outfit_log(user_id, start, end)


@router.post("/users/{user_id}/outfit-log", response_model=OutfitLogEntry)
async def create_outfit_log(user_id: str, body: LogOutfitRequest):
    """Record a full outfit worn on a given date."""
    entry = log_outfit(
        user_id,
        body.worn_date,
        body.garment_ids,
        body.event_type,
        body.notes,
    )
    if entry is None:
        raise HTTPException(status_code=500, detail="Failed to log outfit.")
    return entry


@router.get("/users/{user_id}/wardrobe-insights", response_model=GarmentInsights)
async def read_wardrobe_insights(user_id: str):
    """Return aggregated usage stats for the user's wardrobe."""
    return get_garment_insights(user_id)
