from __future__ import annotations

import logging
import os
import re
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, List, Optional, TypedDict

import bcrypt
from supabase import Client, create_client

from .models import (
    AvatarConfig,
    BodyMeasurements,
    GarmentCategory,
    GarmentFormality,
    GarmentGender,
    GarmentItem,
    GarmentSeasonality,
    UserProfile,
    build_garment_tags,
)

logger = logging.getLogger(__name__)

_BCRYPT_PASSWORD_MAX_BYTES = 72


def _password_within_bcrypt_limit(password_plain: str) -> bool:
    return len(password_plain.encode("utf-8")) <= _BCRYPT_PASSWORD_MAX_BYTES

_local_wardrobes: dict[str, List[GarmentItem]] = {}
_local_measurements: dict[str, BodyMeasurements] = {}
_local_user_profiles: dict[str, UserProfile] = {}
# OAuth logins (no Supabase Auth): POST /analytics/register fills this in local dev.
_local_signup_user_ids: set[str] = set()
# Email/password users when Supabase is unavailable or table writes fall back (see create_password_user).
_local_app_users_by_email: dict[str, dict[str, str]] = {}


class PasswordUserRow(TypedDict):
    user_id: str
    email: str
    password_hash: str


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


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


def _measurements_table_name() -> str:
    return os.getenv("SUPABASE_MEASUREMENTS_TABLE", "user_measurements")


def _profiles_table_name() -> str:
    return os.getenv("SUPABASE_PROFILES_TABLE", "user_profiles")


def _signup_registry_table() -> str:
    return (os.getenv("SUPABASE_SIGNUPS_TABLE") or "analytics_registered_users").strip() or "analytics_registered_users"


def _app_users_table() -> str:
    return (os.getenv("SUPABASE_APP_USERS_TABLE") or "app_users").strip() or "app_users"


def normalize_login_email(email: str) -> str:
    """Lowercase trimmed email for lookups (must match mobile ``deriveUserIdFromProfile`` input)."""
    return (email or "").strip().lower()


def user_id_from_email(email_normalized: str) -> str:
    """Same stable id the Expo app uses when profile.email is set without OAuth ``sub``."""
    return "email-" + email_normalized.replace("@", "-at-").replace(".", "-dot-")


def is_valid_login_email(email: str) -> bool:
    normalized = normalize_login_email(email)
    if not normalized or len(normalized) > 254:
        return False
    return bool(_EMAIL_RE.match(normalized))


def get_password_user_by_email(email_normalized: str) -> Optional[PasswordUserRow]:
    if _use_local_store():
        row = _local_app_users_by_email.get(email_normalized)
        if not row:
            return None
        return {
            "user_id": row["user_id"],
            "email": row["email"],
            "password_hash": row["password_hash"],
        }
    try:
        result = (
            get_supabase_client()
            .table(_app_users_table())
            .select("user_id,email,password_hash")
            .eq("email", email_normalized)
            .maybe_single()
            .execute()
        )
        data = result.data
        if not isinstance(data, dict):
            return None
        uid = data.get("user_id")
        em = data.get("email")
        ph = data.get("password_hash")
        if not uid or not em or not ph:
            return None
        return {"user_id": str(uid), "email": str(em), "password_hash": str(ph)}
    except Exception:
        logger.exception("get_password_user_by_email failed email=%r", email_normalized[:80])
        return None


def create_password_user(email_normalized: str, password_plain: str) -> PasswordUserRow:
    """
    Create a new email/password row. Raises ``ValueError("email_taken")`` if the email exists.
    """
    if not is_valid_login_email(email_normalized):
        raise ValueError("invalid_email")
    if len(password_plain) < 8:
        raise ValueError("weak_password")
    if not _password_within_bcrypt_limit(password_plain):
        raise ValueError("weak_password")

    if get_password_user_by_email(email_normalized):
        raise ValueError("email_taken")

    pw_hash = bcrypt.hashpw(password_plain.encode("utf-8"), bcrypt.gensalt()).decode("ascii")
    user_id = user_id_from_email(email_normalized)
    row: PasswordUserRow = {"user_id": user_id, "email": email_normalized, "password_hash": pw_hash}

    if _use_local_store():
        _local_app_users_by_email[email_normalized] = {
            "user_id": user_id,
            "email": email_normalized,
            "password_hash": pw_hash,
        }
        return row

    try:
        get_supabase_client().table(_app_users_table()).insert(
            {
                "user_id": user_id,
                "email": email_normalized,
                "password_hash": pw_hash,
            }
        ).execute()
        return row
    except Exception:
        logger.exception("create_password_user insert failed email=%r", email_normalized[:80])
        raise


def verify_password_user(email_normalized: str, password_plain: str) -> Optional[str]:
    """
    Return ``user_id`` when credentials match, else ``None``.
    """
    row = get_password_user_by_email(email_normalized)
    if not row:
        return None
    try:
        ok = bcrypt.checkpw(
            password_plain.encode("utf-8"),
            row["password_hash"].encode("ascii"),
        )
    except Exception:
        logger.exception("verify_password_user bcrypt failed user_id=%r", row["user_id"][:40])
        return None
    return row["user_id"] if ok else None


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


def _parse_gender(value: Any) -> Optional[GarmentGender]:
    if value in (None, ""):
        return None
    try:
        return GarmentGender(str(value))
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
    gender = _parse_gender(row.get("gender"))

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
        gender=gender,
        times_recommended=int(row.get("times_recommended") or 0),
        hidden_from_recommendations=bool(row.get("hidden_from_recommendations") or False),
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


_SUPABASE_GARMENT_COLUMNS = {
    "id", "user_id", "primary_image_url", "alt_image_urls",
    "category", "sub_category", "color_primary", "color_secondary",
    "pattern", "formality", "seasonality", "brand", "size",
    "material", "fit_notes", "embedding_id", "created_at", "updated_at",
}


def _supabase_payload(garment: GarmentItem) -> dict:
    """Build an insert-safe dict containing only columns present in the DB."""
    raw = garment.model_dump(mode="json")
    return {k: v for k, v in raw.items() if k in _SUPABASE_GARMENT_COLUMNS}


def insert_garment(garment: GarmentItem) -> GarmentItem:
    garment = _ensure_garment_tags(garment)
    if _use_local_store():
        current = _local_wardrobes.get(garment.user_id, [])
        _local_wardrobes[garment.user_id] = [garment] + current
        return garment
    payload = _supabase_payload(garment)
    result = get_supabase_client().table(_table_name()).insert(payload).execute()
    row = (result.data or [payload])[0]
    return _row_to_garment(row)


def set_wardrobe(user_id: str, items: List[GarmentItem]) -> None:
    """Replace the entire wardrobe for *user_id* with *items*.

    In local mode this directly resets the in-memory store.  Supabase mode
    deletes all existing rows then re-inserts, so use sparingly in production.
    """
    if _use_local_store():
        _local_wardrobes[user_id] = [_ensure_garment_tags(g) for g in items]
        return

    client = get_supabase_client()
    client.table(_table_name()).delete().eq("user_id", user_id).execute()
    for garment in items:
        payload = _supabase_payload(garment)
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


def increment_recommendation_counts(garment_ids: List[str], user_id: str) -> None:
    """Increment ``times_recommended`` for each garment in *garment_ids*.

    *garment_ids* may contain duplicate entries (the same garment recommended
    on multiple days).  Each occurrence counts as one additional recommendation,
    so a ``Counter`` is used to sum occurrences before writing.

    In local mode this mutates the in-memory store directly.
    In Supabase mode each increment is a single UPDATE (no RPC required).
    Failures are logged but never re-raised — recommendation generation must
    not fail because of a counter update.
    """
    if not garment_ids:
        return
    from collections import Counter
    counts = Counter(garment_ids)  # {garment_id: occurrences}

    if _use_local_store():
        wardrobe = _local_wardrobes.get(user_id, [])
        _local_wardrobes[user_id] = [
            g.model_copy(update={"times_recommended": g.times_recommended + counts[g.id]})
            if g.id in counts else g
            for g in wardrobe
        ]
        return
    client = get_supabase_client()
    for gid, delta in counts.items():
        try:
            client.rpc(
                "increment_garment_recommended",
                {"garment_id": gid, "delta": delta},
            ).execute()
        except Exception:
            # RPC may not exist yet — fall back to a read-modify-write.
            try:
                result = (
                    client.table(_table_name())
                    .select("times_recommended")
                    .eq("id", gid)
                    .eq("user_id", user_id)
                    .maybe_single()
                    .execute()
                )
                current = int((result.data or {}).get("times_recommended") or 0)
                client.table(_table_name()).update(
                    {"times_recommended": current + delta}
                ).eq("id", gid).eq("user_id", user_id).execute()
            except Exception:
                logger.exception("Failed to increment times_recommended for garment %s", gid)


def set_garment_hidden(garment_id: str, user_id: str, hidden: bool) -> Optional[GarmentItem]:
    """Toggle ``hidden_from_recommendations`` for a single garment.

    Returns the updated garment, or ``None`` if not found.
    """
    now = datetime.utcnow()
    if _use_local_store():
        wardrobe = _local_wardrobes.get(user_id, [])
        updated: Optional[GarmentItem] = None
        new_wardrobe = []
        for g in wardrobe:
            if g.id == garment_id:
                updated = g.model_copy(
                    update={"hidden_from_recommendations": hidden, "updated_at": now}
                )
                new_wardrobe.append(updated)
            else:
                new_wardrobe.append(g)
        _local_wardrobes[user_id] = new_wardrobe
        return updated
    try:
        result = (
            get_supabase_client()
            .table(_table_name())
            .update({"hidden_from_recommendations": hidden, "updated_at": now.isoformat()})
            .eq("id", garment_id)
            .eq("user_id", user_id)
            .execute()
        )
        rows = result.data or []
        return _row_to_garment(rows[0]) if rows else None
    except Exception:
        logger.exception("set_garment_hidden failed garment_id=%s", garment_id)
        return None


def delete_garment(garment_id: str, user_id: str) -> bool:
    """Permanently remove a single garment from a user's wardrobe.

    Returns ``True`` if the garment was found and deleted, ``False`` otherwise.
    """
    if _use_local_store():
        wardrobe = _local_wardrobes.get(user_id, [])
        new_wardrobe = [g for g in wardrobe if g.id != garment_id]
        found = len(new_wardrobe) < len(wardrobe)
        _local_wardrobes[user_id] = new_wardrobe
        return found
    try:
        result = (
            get_supabase_client()
            .table(_table_name())
            .delete()
            .eq("id", garment_id)
            .eq("user_id", user_id)
            .execute()
        )
        rows = result.data or []
        return len(rows) > 0
    except Exception:
        logger.exception("delete_garment failed garment_id=%s", garment_id)
        raise


# ---------------------------------------------------------------------------
# Body measurements
# ---------------------------------------------------------------------------


def get_measurements(user_id: str) -> Optional[BodyMeasurements]:
    """Return saved body measurements for *user_id*, or ``None``."""
    if _use_local_store():
        return _local_measurements.get(user_id)
    try:
        result = (
            get_supabase_client()
            .table(_measurements_table_name())
            .select("*")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        if not rows:
            return None
        return _row_to_measurements(rows[0])
    except Exception:
        logger.exception("get_measurements failed user_id=%s", user_id)
        return None


def upsert_measurements(measurements: BodyMeasurements) -> BodyMeasurements:
    """Create or replace body measurements for a user."""
    if _use_local_store():
        _local_measurements[measurements.user_id] = measurements
        return measurements
    payload = measurements.model_dump(mode="json")
    try:
        result = (
            get_supabase_client()
            .table(_measurements_table_name())
            .upsert(payload, on_conflict="user_id")
            .execute()
        )
        row = (result.data or [payload])[0]
        return _row_to_measurements(row)
    except Exception:
        logger.exception("upsert_measurements failed user_id=%s", measurements.user_id)
        return measurements


def _row_to_measurements(row: dict[str, Any]) -> BodyMeasurements:
    def _float_or_none(key: str) -> Optional[float]:
        v = row.get(key)
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    return BodyMeasurements(
        user_id=str(row.get("user_id", "")),
        height_cm=_float_or_none("height_cm"),
        weight_kg=_float_or_none("weight_kg"),
        chest_cm=_float_or_none("chest_cm"),
        waist_cm=_float_or_none("waist_cm"),
        hips_cm=_float_or_none("hips_cm"),
        inseam_cm=_float_or_none("inseam_cm"),
        updated_at=_parse_datetime(row.get("updated_at")),
    )


# ---------------------------------------------------------------------------
# User profile (style preferences, sizes, avatar)
# ---------------------------------------------------------------------------


def _row_to_user_profile(row: dict[str, Any]) -> UserProfile:
    """Deserialise a Supabase ``user_profiles`` row into a :class:`UserProfile`."""
    avatar_raw = row.get("avatar_config")
    avatar: Optional[AvatarConfig] = None
    if isinstance(avatar_raw, dict):
        avatar = AvatarConfig(
            hair_style=avatar_raw.get("hair_style"),
            hair_color=avatar_raw.get("hair_color"),
            body_type=avatar_raw.get("body_type"),
            skin_tone=avatar_raw.get("skin_tone"),
        )

    def _str_list(key: str) -> list[str]:
        v = row.get(key)
        if isinstance(v, list):
            return [str(x) for x in v]
        return []

    return UserProfile(
        user_id=str(row.get("user_id", "")),
        gender=row.get("gender"),
        birthday=row.get("birthday"),
        skin_tone=row.get("skin_tone"),
        color_tone=row.get("color_tone"),
        favorite_colors=_str_list("favorite_colors"),
        avoided_colors=_str_list("avoided_colors"),
        shoe_size=row.get("shoe_size"),
        top_size=row.get("top_size"),
        bottom_size=row.get("bottom_size"),
        avatar_config=avatar,
        updated_at=_parse_datetime(row.get("updated_at")),
    )


def get_user_profile(user_id: str) -> Optional[UserProfile]:
    """Return the style profile for *user_id*, or ``None`` if not yet created."""
    if _use_local_store():
        return _local_user_profiles.get(user_id)
    try:
        result = (
            get_supabase_client()
            .table(_profiles_table_name())
            .select("*")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        if not rows:
            return None
        return _row_to_user_profile(rows[0])
    except Exception:
        logger.exception("get_user_profile failed user_id=%s", user_id)
        return None


def upsert_user_profile(user_id: str, data: dict[str, Any]) -> UserProfile:
    """
    Create or update the style profile for *user_id*.

    *data* may be a partial dict — only provided keys are written.  The
    ``user_id`` and ``updated_at`` fields are always set automatically.
    """
    now = datetime.utcnow()
    payload: dict[str, Any] = {k: v for k, v in data.items() if k not in ("user_id", "updated_at")}
    payload["user_id"] = user_id
    payload["updated_at"] = now.isoformat()

    # Serialise avatar_config to a plain dict for Supabase jsonb.
    if "avatar_config" in payload and isinstance(payload["avatar_config"], AvatarConfig):
        payload["avatar_config"] = payload["avatar_config"].model_dump(mode="json", exclude_none=True)

    if _use_local_store():
        existing = _local_user_profiles.get(user_id)
        if existing:
            merged = existing.model_dump()
            merged.update(payload)
            profile = _row_to_user_profile(merged)
        else:
            profile = _row_to_user_profile(payload)
        _local_user_profiles[user_id] = profile
        return profile

    try:
        result = (
            get_supabase_client()
            .table(_profiles_table_name())
            .upsert(payload, on_conflict="user_id")
            .execute()
        )
        row = (result.data or [payload])[0]
        return _row_to_user_profile(row)
    except Exception:
        logger.exception("upsert_user_profile failed user_id=%s", user_id)
        # Return a best-effort object so callers don't crash.
        return _row_to_user_profile(payload)


# ---------------------------------------------------------------------------
# Avatar image storage
# ---------------------------------------------------------------------------

_LOCAL_AVATARS_DIR = Path(os.getenv("LOCAL_AVATARS_DIR", "outputs/local_avatars"))
_LOCAL_AVATARS_DIR.mkdir(parents=True, exist_ok=True)

_AVATAR_BUCKET = lambda: (os.getenv("AVATAR_STORAGE_BUCKET") or "avatars").strip()  # noqa: E731


def store_avatar_image(user_id: str, image_bytes: bytes) -> str:
    """
    Persist a generated avatar JPEG and return its public URL.

    Local mode  → writes to ``outputs/local_avatars/{user_id}.jpg`` and
                  returns the relative path ``/assets/local-avatars/{user_id}.jpg``
                  (served by the FastAPI static-files mount added in ``main.py``).

    Supabase mode → uploads to the ``AVATAR_STORAGE_BUCKET`` bucket at path
                    ``{user_id}/avatar.jpg`` (upsert so re-generation overwrites)
                    and returns the public URL via ``get_public_url``.
    """
    safe_id = re.sub(r"[^A-Za-z0-9_\-]", "_", user_id)[:128]

    if _use_local_store():
        dest = _LOCAL_AVATARS_DIR / f"{safe_id}.jpg"
        dest.write_bytes(image_bytes)
        return f"/assets/local-avatars/{safe_id}.jpg"

    storage_path = f"{safe_id}/avatar.jpg"
    bucket = _AVATAR_BUCKET()
    try:
        client = get_supabase_client()
        client.storage.from_(bucket).upload(
            path=storage_path,
            file=image_bytes,
            file_options={"content-type": "image/jpeg", "upsert": "true"},
        )
        url_resp = client.storage.from_(bucket).get_public_url(storage_path)
        return str(url_resp)
    except Exception:
        logger.exception("store_avatar_image failed user_id=%s", user_id)
        raise
