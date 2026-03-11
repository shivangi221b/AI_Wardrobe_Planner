from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
import logging

from supabase import Client, create_client

logger = logging.getLogger(__name__)

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


def _save_garment_image_locally(user_id: str, garment_id: str, image_bytes: bytes) -> str:
    root = _local_storage_dir()
    user_dir = root / user_id
    user_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{garment_id}.jpg"
    file_path = user_dir / filename
    file_path.write_bytes(image_bytes)
    url = f"{_local_base_url()}/assets/local-garments/{user_id}/{filename}"
    logger.info("Saved local garment asset path=%s bytes=%d", file_path, len(image_bytes))
    return url


def upload_garment_image(user_id: str, garment_id: str, image_bytes: bytes) -> str:
    if _storage_mode() == "local":
        return _save_garment_image_locally(user_id, garment_id, image_bytes)

    bucket = os.getenv("SUPABASE_GARMENTS_BUCKET", "garments")
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
