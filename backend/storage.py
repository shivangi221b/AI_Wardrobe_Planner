from __future__ import annotations

import logging
import os
import re
import urllib.parse
from functools import lru_cache
from pathlib import Path
from typing import List, Optional

from supabase import Client, create_client

from .db import (
    add_garments,
    get_wardrobe,
    set_wardrobe,
)
from .models import GarmentItem, WeekEvent

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Week-events store — kept in-memory until a DB table is provisioned.
# ---------------------------------------------------------------------------

_week_events: dict[str, List[WeekEvent]] = {}


def get_week_events(user_id: str) -> List[WeekEvent]:
    """Return the current week plan for *user_id*, or an empty list."""
    return list(_week_events.get(user_id, []))


def store_week_events(user_id: str, events: List[WeekEvent]) -> None:
    """Persist (overwrite) the week plan for *user_id*."""
    _week_events[user_id] = list(events)


def user_exists(user_id: str) -> bool:
    """Return True if *user_id* has any record in either store."""
    return bool(get_wardrobe(user_id)) or user_id in _week_events


__all__ = [
    "get_wardrobe",
    "set_wardrobe",
    "add_garments",
    "get_week_events",
    "store_week_events",
    "user_exists",
    "upload_garment_image",
    "delete_garment_image_assets",
    "garment_storage_object_path_from_public_url",
]

@lru_cache(maxsize=1)
def get_supabase_client() -> Client:
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_service_key = os.getenv("SUPABASE_SERVICE_KEY")
    if not supabase_url or not supabase_service_key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY.")
    return create_client(supabase_url, supabase_service_key)


def _storage_mode() -> str:
    return os.getenv("IMAGE_STORAGE_BACKEND", "supabase").strip().lower()


def _local_storage_dir() -> Path:
    configured = os.getenv("LOCAL_GARMENTS_DIR", "outputs/local_garments")
    return Path(configured)


def _local_base_url() -> str:
    return os.getenv("LOCAL_ASSET_BASE_URL", "http://127.0.0.1:8000").rstrip("/")


def _safe_segment(value: str) -> str:
    """
    Sanitize user-controlled ids before using them in filesystem paths.
    """
    cleaned = re.sub(r"[^a-zA-Z0-9._-]", "_", str(value))
    return cleaned or "anon"


def _save_garment_image_locally(user_id: str, garment_id: str, image_bytes: bytes) -> str:
    root = _local_storage_dir()
    safe_user_id = _safe_segment(user_id)
    safe_garment_id = _safe_segment(garment_id)
    user_dir = root / safe_user_id
    user_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{safe_garment_id}.jpg"
    file_path = user_dir / filename
    file_path.write_bytes(image_bytes)
    url = f"{_local_base_url()}/assets/local-garments/{safe_user_id}/{filename}"
    logger.info("Saved local garment asset path=%s bytes=%d", file_path, len(image_bytes))
    return url


def _garments_bucket_name() -> str:
    return os.getenv("SUPABASE_GARMENTS_BUCKET", "garments").strip() or "garments"


def garment_storage_object_path_from_public_url(public_url: str, bucket: Optional[str] = None) -> Optional[str]:
    """
    Given a Supabase *public* object URL, return the object key inside *bucket*
    (e.g. ``user-id/uuid.jpg``), or ``None`` if the URL does not point at that bucket.
    """
    if not public_url or not str(public_url).strip():
        return None
    raw = urllib.parse.unquote(str(public_url).strip())
    b = bucket or _garments_bucket_name()
    for marker in (f"/storage/v1/object/public/{b}/", f"/object/public/{b}/"):
        if marker in raw:
            path = raw.split(marker, 1)[1]
            path = path.split("?", 1)[0].split("#", 1)[0].strip().lstrip("/")
            return path or None
    return None


def delete_garment_image_assets(image_urls: List[Optional[str]]) -> None:
    """
    Best-effort deletion of garment images from Supabase Storage or the local dev folder.

    Callers should invoke this *before* removing the DB row so we still know the URLs.
    External URLs (e.g. SerpAPI thumbnails) are ignored.
    """
    for raw in image_urls:
        if not raw:
            continue
        url = str(raw).strip()
        if not url:
            continue
        _try_delete_supabase_garment_object(url)
        _try_delete_local_garment_file(url)


def _try_delete_supabase_garment_object(public_url: str) -> None:
    path = garment_storage_object_path_from_public_url(public_url)
    if not path:
        return
    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SERVICE_KEY"):
        return
    bucket = _garments_bucket_name()
    try:
        client = get_supabase_client()
        client.storage.from_(bucket).remove([path])
        logger.info("Deleted garment image from Supabase bucket=%s path=%s", bucket, path)
    except Exception:
        logger.warning(
            "Could not delete garment image from Supabase bucket=%s path=%s",
            bucket,
            path,
            exc_info=True,
        )


_LOCAL_GARMENT_URL_RE = re.compile(r"/assets/local-garments/([^/]+)/([^/?#]+)")


def _try_delete_local_garment_file(url: str) -> None:
    m = _LOCAL_GARMENT_URL_RE.search(url)
    if not m:
        return
    safe_user, filename = m.group(1), m.group(2)
    root = _local_storage_dir().resolve()
    candidate = (root / safe_user / filename).resolve()
    try:
        if not str(candidate).startswith(str(root)):
            logger.warning("Refusing to delete local garment path outside root: %s", candidate)
            return
    except (OSError, ValueError):
        return
    try:
        if candidate.is_file():
            candidate.unlink()
            logger.info("Deleted local garment image path=%s", candidate)
    except Exception:
        logger.warning("Could not delete local garment file path=%s", candidate, exc_info=True)


def upload_garment_image(user_id: str, garment_id: str, image_bytes: bytes) -> str:
    mode = _storage_mode()
    if mode == "local":
        return _save_garment_image_locally(user_id, garment_id, image_bytes)

    # Be resilient in dev: if Supabase creds aren't present, fall back to local
    # storage instead of crashing the whole vision pipeline.
    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SERVICE_KEY"):
        logger.warning(
            "Supabase storage requested (mode=%s) but SUPABASE_URL/SUPABASE_SERVICE_KEY missing; falling back to local.",
            mode,
        )
        return _save_garment_image_locally(user_id, garment_id, image_bytes)

    bucket = _garments_bucket_name()
    path = f"{user_id}/{garment_id}.jpg"
    client = get_supabase_client()

    # Keep upload idempotent while iterating quickly in development.
    client.storage.from_(bucket).upload(
        path,
        image_bytes,
        file_options={"content-type": "image/jpeg", "upsert": "true"},
    )
    url = client.storage.from_(bucket).get_public_url(path)
    logger.info("Uploaded garment asset to Supabase bucket=%s path=%s bytes=%d", bucket, path, len(image_bytes))
    return url
