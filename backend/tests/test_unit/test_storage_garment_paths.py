"""Unit tests for garment storage URL parsing (used on delete)."""

from __future__ import annotations

import pytest

from backend.storage import garment_storage_object_path_from_public_url


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        (
            "https://abc.supabase.co/storage/v1/object/public/garments/google-105/6c64452e-e27b.jpg",
            "google-105/6c64452e-e27b.jpg",
        ),
        (
            "https://abc.supabase.co/storage/v1/object/public/garments/u/file.jpg?download=1",
            "u/file.jpg",
        ),
        ("https://cdn.example.com/other-bucket/u/file.jpg", None),
        ("https://example.com/serp-thumb.jpg", None),
    ],
)
def test_garment_storage_object_path_from_public_url(url: str, expected: str | None) -> None:
    assert garment_storage_object_path_from_public_url(url, bucket="garments") == expected
