from __future__ import annotations

import os
from datetime import datetime
from functools import lru_cache
from typing import Any, List, Optional

from supabase import Client, create_client

from .models import (
    GarmentCategory,
    GarmentFormality,
    GarmentItem,
    GarmentSeasonality,
)

_local_wardrobes: dict[str, List[GarmentItem]] = {}


@lru_cache(maxsize=1)
def get_supabase_client() -> Client:
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_service_key = os.getenv("SUPABASE_SERVICE_KEY")
    if not supabase_url or not supabase_service_key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY.")
    return create_client(supabase_url, supabase_service_key)


def _use_local_store() -> bool:
    backend = os.getenv("IMAGE_STORAGE_BACKEND", "supabase").strip().lower()
    has_supabase = bool(os.getenv("SUPABASE_URL")) and bool(os.getenv("SUPABASE_SERVICE_KEY"))
    return backend == "local" and not has_supabase


def _table_name() -> str:
    return os.getenv("SUPABASE_GARMENTS_TABLE", "garments")


def _parse_category(value: Any) -> GarmentCategory:
    try:
        return GarmentCategory(str(value))
    except Exception:
        return GarmentCategory.TOP


def _parse_formality(value: Any) -> Optional[GarmentFormality]:
    if value in (None, ""):
        return None
    try:
        return GarmentFormality(str(value))
    except Exception:
        return None


def _parse_seasonality(value: Any) -> Optional[GarmentSeasonality]:
    if value in (None, ""):
        return None
    try:
        return GarmentSeasonality(str(value))
    except Exception:
        return None


def _parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        normalized = value.replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(normalized)
        except ValueError:
            # Some providers emit non-standard fractional second lengths.
            if "." in normalized:
                head, tail = normalized.split(".", 1)
                tz_pos = tail.find("+")
                if tz_pos == -1:
                    tz_pos = tail.find("-")
                if tz_pos == -1:
                    frac = tail
                    tz = ""
                else:
                    frac = tail[:tz_pos]
                    tz = tail[tz_pos:]
                frac = (frac + "000000")[:6]
                return datetime.fromisoformat(f"{head}.{frac}{tz}")
            raise
    return datetime.utcnow()


def _row_to_garment(row: dict[str, Any]) -> GarmentItem:
    return GarmentItem(
        id=str(row.get("id")),
        user_id=str(row.get("user_id")),
        primary_image_url=str(row.get("primary_image_url")),
        alt_image_urls=row.get("alt_image_urls") or [],
        category=_parse_category(row.get("category")),
        sub_category=row.get("sub_category"),
        color_primary=row.get("color_primary"),
        color_secondary=row.get("color_secondary"),
        pattern=row.get("pattern"),
        formality=_parse_formality(row.get("formality")),
        seasonality=_parse_seasonality(row.get("seasonality")),
        brand=row.get("brand"),
        size=row.get("size"),
        material=row.get("material"),
        fit_notes=row.get("fit_notes"),
        embedding_id=row.get("embedding_id"),
        created_at=_parse_datetime(row.get("created_at")),
        updated_at=_parse_datetime(row.get("updated_at")),
    )


def get_wardrobe(user_id: str) -> List[GarmentItem]:
    if _use_local_store():
        return list(_local_wardrobes.get(user_id, []))

    result = (
        get_supabase_client()
        .table(_table_name())
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    rows = result.data or []
    return [_row_to_garment(row) for row in rows]


def insert_garment(garment: GarmentItem) -> GarmentItem:
    if _use_local_store():
        current = _local_wardrobes.get(garment.user_id, [])
        _local_wardrobes[garment.user_id] = [garment] + current
        return garment

    payload = garment.model_dump(mode="json")
    result = get_supabase_client().table(_table_name()).insert(payload).execute()
    row = (result.data or [payload])[0]
    return _row_to_garment(row)
