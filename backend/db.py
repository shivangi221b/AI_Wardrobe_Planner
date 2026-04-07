from __future__ import annotations

import logging
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
    build_garment_tags,
)

logger = logging.getLogger(__name__)

_local_wardrobes: dict[str, List[GarmentItem]] = {}
# OAuth logins (no Supabase Auth): POST /analytics/register fills this in local dev.
_local_signup_user_ids: set[str] = set()


@lru_cache(maxsize=1)
def get_supabase_client() -> Client:
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_service_key = os.getenv("SUPABASE_SERVICE_KEY")
    if not supabase_url or not supabase_service_key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY.")
    return create_client(supabase_url, supabase_service_key)


def _use_local_store() -> bool:
    has_supabase = bool(os.getenv("SUPABASE_URL")) and bool(os.getenv("SUPABASE_SERVICE_KEY"))
    # If Supabase is not configured, always fall back to local store.
    if not has_supabase:
        return True
    backend = os.getenv("IMAGE_STORAGE_BACKEND", "supabase").strip().lower()
    return backend == "local"


def _table_name() -> str:
    return os.getenv("SUPABASE_GARMENTS_TABLE", "garments")


def _signup_registry_table() -> str:
    return (os.getenv("SUPABASE_SIGNUPS_TABLE") or "analytics_registered_users").strip() or "analytics_registered_users"


def register_signup_user_id(user_id: str) -> None:
    """
    Idempotent: record that *user_id* completed app login (OAuth) for metrics.

    Requires table ``analytics_registered_users`` (see ``scripts/sql/analytics_registered_users.sql``).
    """
    uid = (user_id or "").strip()
    if not uid or len(uid) > 512:
        return
    if _use_local_store():
        _local_signup_user_ids.add(uid)
        return
    try:
        get_supabase_client().table(_signup_registry_table()).upsert({"user_id": uid}).execute()
    except Exception:
        logger.exception("register_signup_user_id failed user_id=%r", uid[:80])


def count_registered_signups() -> int:
    """Rows in the signup registry table (or local set size)."""
    if _use_local_store():
        return len(_local_signup_user_ids)
    try:
        result = (
            get_supabase_client()
            .table(_signup_registry_table())
            .select("user_id", count="exact", head=True)
            .execute()
        )
        return int(result.count or 0)
    except Exception:
        logger.exception("count_registered_signups failed")
        return 0


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
    category = _parse_category(row.get("category"))
    formality = _parse_formality(row.get("formality"))
    seasonality = _parse_seasonality(row.get("seasonality"))

    raw_tags = row.get("tags")
    if isinstance(raw_tags, list):
        tags = [str(tag) for tag in raw_tags]
    else:
        tags = build_garment_tags(category, formality, seasonality)

    return GarmentItem(
        id=str(row.get("id")),
        user_id=str(row.get("user_id")),
        primary_image_url=str(row.get("primary_image_url")),
        alt_image_urls=row.get("alt_image_urls") or [],
        category=category,
        sub_category=row.get("sub_category"),
        color_primary=row.get("color_primary"),
        color_secondary=row.get("color_secondary"),
        pattern=row.get("pattern"),
        formality=formality,
        seasonality=seasonality,
        brand=row.get("brand"),
        size=row.get("size"),
        material=row.get("material"),
        fit_notes=row.get("fit_notes"),
        embedding_id=row.get("embedding_id"),
        tags=tags,
        created_at=_parse_datetime(row.get("created_at")),
        updated_at=_parse_datetime(row.get("updated_at")),
    )


def _rpc_name_for_distinct_garment_users() -> Optional[str]:
    """RPC that returns COUNT(DISTINCT user_id); see scripts/sql/metrics_count_distinct_garment_users.sql."""
    explicit = (os.getenv("SUPABASE_GARMENTS_DISTINCT_USERS_RPC") or "").strip()
    if explicit:
        return explicit
    if _table_name() == "garments":
        return "metrics_count_distinct_garment_users"
    return None


def _parse_rpc_scalar_int(data: Any) -> Optional[int]:
    if data is None:
        return None
    if isinstance(data, bool):
        return None
    if isinstance(data, int):
        return data
    if isinstance(data, float):
        return int(data)
    if isinstance(data, str) and data.isdigit():
        return int(data)
    if isinstance(data, list) and len(data) == 1:
        return _parse_rpc_scalar_int(data[0])
    if isinstance(data, dict) and len(data) == 1:
        return _parse_rpc_scalar_int(next(iter(data.values())))
    return None


def _count_distinct_wardrobe_user_ids_via_rpc() -> Optional[int]:
    name = _rpc_name_for_distinct_garment_users()
    if not name:
        return None
    try:
        result = get_supabase_client().rpc(name).execute()
        n = _parse_rpc_scalar_int(result.data)
        return n if n is not None and n >= 0 else None
    except Exception:
        logger.warning(
            "RPC %r unavailable or failed; falling back to paginated distinct count",
            name,
            exc_info=True,
        )
        return None


def _count_distinct_wardrobe_user_ids_paginated() -> int:
    """Fetch only ``user_id`` in pages; memory O(distinct users), not O(rows)."""
    client = get_supabase_client()
    table = _table_name()
    page_size = 1000
    seen: set[str] = set()
    offset = 0
    try:
        while True:
            result = (
                client.table(table)
                .select("user_id")
                .range(offset, offset + page_size - 1)
                .execute()
            )
            rows = result.data or []
            for row in rows:
                uid = row.get("user_id")
                if uid is not None:
                    seen.add(str(uid))
            if len(rows) < page_size:
                break
            offset += page_size
            if offset > 10_000_000:
                logger.warning(
                    "count_distinct_wardrobe_user_ids pagination stopped at offset=%s", offset
                )
                break
        return len(seen)
    except Exception:
        logger.exception("count_distinct_wardrobe_user_ids paginated query failed")
        return 0


def count_distinct_wardrobe_user_ids() -> int:
    """
    Distinct ``user_id`` values in the garments table (or local store keys).

    The mobile app signs in with Google/Apple via OAuth only — it does **not**
    create Supabase Auth users — so this count is used as a practical signup
    proxy for anyone who has saved at least one garment.

    Prefer ``metrics_count_distinct_garment_users`` RPC (single round-trip, server-side
    ``COUNT(DISTINCT)``). If the RPC is missing, the table is not ``garments``, or the
    call fails, falls back to paginated ``user_id`` scans (bounded memory by distinct users).
    """
    if _use_local_store():
        return len(_local_wardrobes)
    via_rpc = _count_distinct_wardrobe_user_ids_via_rpc()
    if via_rpc is not None:
        return via_rpc
    return _count_distinct_wardrobe_user_ids_paginated()


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


def _ensure_garment_tags(garment: GarmentItem) -> GarmentItem:
    """Return a copy of *garment* with tags populated when missing or empty.

    This keeps local-storage mode and Supabase-backed mode consistent: both
    expose garments whose ``tags`` field always reflects the current
    ``category``, ``formality``, and ``seasonality`` values.
    """
    if garment.tags:
        return garment
    return garment.model_copy(
        update={
            "tags": build_garment_tags(
                garment.category,
                garment.formality,
                garment.seasonality,
            )
        }
    )


def insert_garment(garment: GarmentItem) -> GarmentItem:
    garment = _ensure_garment_tags(garment)
    if _use_local_store():
        current = _local_wardrobes.get(garment.user_id, [])
        _local_wardrobes[garment.user_id] = [garment] + current
        return garment
    # Supabase table may not yet have a dedicated "tags" column; drop it from
    # the payload and let consumers recompute tags from the structured enums.
    payload = garment.model_dump(mode="json")
    payload.pop("tags", None)
    result = get_supabase_client().table(_table_name()).insert(payload).execute()
    row = (result.data or [payload])[0]
    return _row_to_garment(row)


def set_wardrobe(user_id: str, items: List[GarmentItem]) -> None:
    """Replace the entire wardrobe for *user_id* with *items*.

    In local mode this directly resets the in-memory store.  Supabase mode
    deletes all existing rows then re-inserts, so use sparingly in production.
    """
    if _use_local_store():
        _local_wardrobes[user_id] = [ _ensure_garment_tags(g) for g in items ]
        return

    client = get_supabase_client()
    client.table(_table_name()).delete().eq("user_id", user_id).execute()
    for garment in items:
        payload = garment.model_dump(mode="json")
        payload.pop("tags", None)
        client.table(_table_name()).insert(payload).execute()


def add_garments(user_id: str, items: List[GarmentItem]) -> None:
    """Append *items* to the wardrobe for *user_id*.

    Each garment's user_id is overridden with the supplied *user_id* before
    insertion so that a mismatched GarmentItem.user_id can never silently
    write under a different owner.

    Intended for use by the ingestion worker once it finishes processing a job.
    """
    for garment in items:
        enforced = garment.model_copy(update={"user_id": user_id})
        insert_garment(enforced)
