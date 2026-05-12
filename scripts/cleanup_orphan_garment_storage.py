#!/usr/bin/env python3
"""
Remove orphan objects in the Supabase Storage "garments" bucket (local run).

Supabase blocks ``DELETE FROM storage.objects`` in SQL (storage.protect_delete).
This script uses the Storage API with your service role key instead.

Setup (from repo root):
  pip install supabase python-dotenv   # if not already installed
  export SUPABASE_URL=...
  export SUPABASE_SERVICE_KEY=...
  # optional: SUPABASE_GARMENTS_BUCKET=garments  SUPABASE_GARMENTS_TABLE=garments

Or rely on ``.env`` at the repo root (same vars as the backend).

Usage:
  python3 scripts/cleanup_orphan_garment_storage.py           # dry-run: list orphans only
  python3 scripts/cleanup_orphan_garment_storage.py --execute # actually delete
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")
load_dotenv(ROOT / "backend" / ".env", override=False)


def _bucket_name() -> str:
    return (os.getenv("SUPABASE_GARMENTS_BUCKET") or "garments").strip() or "garments"


def _table_name() -> str:
    return (os.getenv("SUPABASE_GARMENTS_TABLE") or "garments").strip() or "garments"


def _object_path_from_public_url(public_url: str, bucket: str) -> str | None:
    if not public_url or not str(public_url).strip():
        return None
    raw = urllib.parse.unquote(str(public_url).strip())
    b = bucket
    for marker in (f"/storage/v1/object/public/{b}/", f"/object/public/{b}/"):
        if marker in raw:
            path = raw.split(marker, 1)[1]
            path = path.split("?", 1)[0].split("#", 1)[0].strip().lstrip("/")
            return path or None
    return None


def _collect_reference_urls(rows: list[dict]) -> list[str]:
    urls: list[str] = []
    for row in rows:
        p = row.get("primary_image_url")
        if p:
            urls.append(str(p))
        alts = row.get("alt_image_urls")
        if isinstance(alts, str):
            try:
                alts = json.loads(alts)
            except json.JSONDecodeError:
                alts = []
        if isinstance(alts, list):
            urls.extend(str(a) for a in alts if a)
    return urls


def _is_object_referenced(object_name: str, urls: list[str]) -> bool:
    """True if any saved garment URL clearly points at this storage object path."""
    name = object_name.strip()
    if not name:
        return False
    name_unquoted = urllib.parse.unquote(name)
    for raw in urls:
        u = urllib.parse.unquote(str(raw))
        if name in u or (name_unquoted != name and name_unquoted in u):
            return True
    return False


def _list_all_file_paths(client, bucket: str) -> list[str]:
    """
    Recursively list file object paths under the bucket.

    Supabase list() returns folders without ``metadata.size``; files include size.
    """
    out: list[str] = []

    def walk(prefix: str) -> None:
        offset = 0
        limit = 1000
        while True:
            path_arg = prefix or ""
            items = client.storage.from_(bucket).list(path_arg, {"limit": limit, "offset": offset})
            if not items:
                break
            for it in items:
                name = it.get("name")
                if not name:
                    continue
                key = f"{prefix}/{name}".replace("//", "/").strip("/") if prefix else name
                meta = it.get("metadata")
                is_file = isinstance(meta, dict) and meta.get("size") is not None
                ext = name.lower().rsplit(".", 1)[-1] if "." in name else ""
                if is_file or ext in ("jpg", "jpeg", "png", "webp", "gif", "heic"):
                    out.append(key)
                else:
                    walk(key)
            if len(items) < limit:
                break
            offset += limit

    walk("")
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually call storage.remove; default is dry-run (print only).",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=50,
        help="Max paths per remove() call (default 50).",
    )
    args = parser.parse_args()

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment or .env", file=sys.stderr)
        return 1

    from supabase import create_client

    bucket = _bucket_name()
    table = _table_name()
    client = create_client(url.rstrip("/"), key)

    # All garment image URLs from DB
    rows: list[dict] = []
    offset = 0
    page = 1000
    while True:
        q = (
            client.table(table)
            .select("primary_image_url, alt_image_urls")
            .range(offset, offset + page - 1)
        )
        res = q.execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page

    ref_urls = _collect_reference_urls(rows)
    # Also add normalized object paths from public URLs (handles encoded segments)
    path_hints: set[str] = set()
    for u in ref_urls:
        p = _object_path_from_public_url(u, bucket)
        if p:
            path_hints.add(p)

    print(f"Bucket: {bucket!r}  Table: {table!r}  Garment rows scanned: {len(rows)}  URL fields: {len(ref_urls)}")

    try:
        all_paths = _list_all_file_paths(client, bucket)
    except Exception as exc:
        print(f"Failed to list storage objects: {exc}", file=sys.stderr)
        return 1

    orphans = [
        p
        for p in all_paths
        if not _is_object_referenced(p, ref_urls) and p not in path_hints
    ]

    if not orphans:
        print("No orphan objects found.")
        return 0

    print(f"Orphan object paths ({len(orphans)}):")
    for p in sorted(orphans)[:200]:
        print(f"  {p}")
    if len(orphans) > 200:
        print(f"  ... and {len(orphans) - 200} more")

    if not args.execute:
        print("\nDry-run only. Re-run with --execute to delete these objects via the Storage API.")
        return 0

    remove_batch = max(1, min(args.batch_size, 500))
    deleted = 0
    for i in range(0, len(orphans), remove_batch):
        chunk = orphans[i : i + remove_batch]
        try:
            client.storage.from_(bucket).remove(chunk)
            deleted += len(chunk)
            print(f"Removed {len(chunk)} objects ({deleted}/{len(orphans)})...")
        except Exception as exc:
            print(f"remove() failed on batch starting {chunk[0]!r}: {exc}", file=sys.stderr)
            return 1

    print(f"Done. Removed {deleted} object(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
