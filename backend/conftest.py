"""Shared pytest fixtures for the backend test suite."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import List
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import httpx
from httpx import ASGITransport

from backend.models import (
    DayOutfitSuggestion,
    GarmentCategory,
    GarmentFormality,
    GarmentItem,
    GarmentSeasonality,
    WeekEvent,
    build_garment_tags,
)


_NOW = datetime(2026, 4, 14, 12, 0, 0, tzinfo=timezone.utc)


def _garment(
    *,
    id: str,
    user_id: str = "test-user",
    category: GarmentCategory = GarmentCategory.TOP,
    sub_category: str | None = None,
    formality: GarmentFormality | None = None,
    seasonality: GarmentSeasonality | None = None,
    brand: str | None = None,
    color_primary: str | None = None,
    image_url: str = "https://example.com/img.jpg",
) -> GarmentItem:
    tags = build_garment_tags(category, formality, seasonality)
    return GarmentItem(
        id=id,
        user_id=user_id,
        primary_image_url=image_url,
        category=category,
        sub_category=sub_category,
        formality=formality,
        seasonality=seasonality,
        brand=brand,
        color_primary=color_primary,
        tags=tags,
        created_at=_NOW,
        updated_at=_NOW,
    )


@pytest.fixture()
def mock_wardrobe() -> List[GarmentItem]:
    """Sample wardrobe covering all key categories and formalities."""
    return [
        _garment(id="g-top-formal", category=GarmentCategory.TOP, sub_category="shirt", formality=GarmentFormality.FORMAL, brand="Brooks Brothers", color_primary="white"),
        _garment(id="g-top-casual", category=GarmentCategory.TOP, sub_category="sweater", formality=GarmentFormality.CASUAL, color_primary="cream"),
        _garment(id="g-top-smart", category=GarmentCategory.TOP, sub_category="blouse", formality=GarmentFormality.SMART_CASUAL, color_primary="navy"),
        _garment(id="g-bottom-formal", category=GarmentCategory.BOTTOM, sub_category="pants", formality=GarmentFormality.FORMAL, color_primary="charcoal"),
        _garment(id="g-bottom-casual", category=GarmentCategory.BOTTOM, sub_category="jeans", formality=GarmentFormality.CASUAL, color_primary="blue"),
        _garment(id="g-shoes", category=GarmentCategory.SHOES, sub_category="loafers", formality=GarmentFormality.SMART_CASUAL),
        _garment(id="g-accessory", category=GarmentCategory.ACCESSORY, sub_category="watch", formality=GarmentFormality.FORMAL),
    ]


@pytest.fixture()
def mock_events() -> List[WeekEvent]:
    """Sample week events for testing."""
    return [
        WeekEvent(day="Monday", event_type="work_meeting"),
        WeekEvent(day="Tuesday", event_type="gym"),
        WeekEvent(day="Wednesday", event_type="casual"),
        WeekEvent(day="Thursday", event_type="work_meeting"),
        WeekEvent(day="Friday", event_type="date_night"),
        WeekEvent(day="Saturday", event_type="casual"),
        WeekEvent(day="Sunday", event_type="casual"),
    ]


@pytest.fixture()
def _isolate_env(monkeypatch):
    """Clear Supabase/GCP env vars so tests use local/fallback paths."""
    for var in (
        "SUPABASE_URL",
        "SUPABASE_SERVICE_KEY",
        "GOOGLE_CLOUD_PROJECT",
        "GOOGLE_CLOUD_LOCATION",
        "SERPAPI_KEY",
        "ANALYTICS_INTERNAL_API_KEY",
        "ANALYTICS_SKIP_KEY_AUTH",
        "ANALYTICS_USE_DUMMY_METRICS",
        "GA4_PROPERTY_ID",
        "FORMSPREE_FORM_ID",
        "FORMSPREE_API_KEY",
        "WAITLIST_SHEET_CSV_URL",
        "IMAGE_STORAGE_BACKEND",
        "LOCAL_ASSET_BASE_URL",
        "CORS_ORIGIN_REGEX",
    ):
        monkeypatch.delenv(var, raising=False)


@pytest.fixture()
def _mock_llm(monkeypatch):
    """Patch LLM so it returns a canned explanation without hitting Vertex AI."""
    async def _fake_explanation(day, event_type, top, bottom):
        return f"Mock explanation for {day} {event_type}"

    monkeypatch.setattr("backend.recommendation.generate_outfit_explanation", _fake_explanation)


@pytest.fixture()
def _mock_vision(monkeypatch):
    """Patch vision extractor to avoid heavy ML imports."""
    from vision.extractor import ExtractedGarmentAsset

    fake_asset = ExtractedGarmentAsset(
        image_bytes=b"\xff\xd8fake-jpeg",
        description="blue shirt",
        category="top",
        sub_category="shirt",
        color_primary="blue",
        pattern=None,
        material=None,
        fit_style=None,
        formality="casual",
        seasonality="all_season",
    )

    def fake_extract(image_bytes, mime_type="image/jpeg"):
        return [fake_asset]

    monkeypatch.setattr("backend.main.extract_garments_from_image", fake_extract)


@pytest.fixture()
def _mock_upload(monkeypatch):
    """Patch garment image upload to return a deterministic URL."""
    _fake = lambda user_id, garment_id, image_bytes: f"https://example.com/storage/{user_id}/{garment_id}.jpg"
    monkeypatch.setattr("backend.storage.upload_garment_image", _fake)


@pytest.fixture()
async def client(_isolate_env, _mock_vision, _mock_upload):
    """Async httpx test client wired to the FastAPI app."""
    from backend.main import app

    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
