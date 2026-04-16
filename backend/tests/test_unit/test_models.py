"""Unit tests for Pydantic models and helpers (backend.models)."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from backend.models import (
    DayOutfitSuggestion,
    GarmentCategory,
    GarmentFormality,
    GarmentItem,
    GarmentSeasonality,
    MediaIngestionJob,
    MediaIngestionStatus,
    MediaType,
    WeekEvent,
    WeekRecommendationRequest,
    build_garment_tags,
)

_NOW = datetime(2026, 4, 14, 12, 0, 0, tzinfo=timezone.utc)


class TestBuildGarmentTags:
    def test_category_only(self):
        tags = build_garment_tags(GarmentCategory.TOP)
        assert tags == ["top"]

    def test_category_plus_formality(self):
        tags = build_garment_tags(GarmentCategory.BOTTOM, formality=GarmentFormality.FORMAL)
        assert tags == ["bottom", "formal"]

    def test_all_params(self):
        tags = build_garment_tags(
            GarmentCategory.SHOES,
            formality=GarmentFormality.CASUAL,
            seasonality=GarmentSeasonality.COLD,
        )
        assert tags == ["shoes", "casual", "cold"]


class TestGarmentItem:
    def test_valid_garment(self):
        g = GarmentItem(
            id="1",
            user_id="u1",
            primary_image_url="https://example.com/img.jpg",
            category=GarmentCategory.TOP,
            created_at=_NOW,
            updated_at=_NOW,
        )
        assert g.id == "1"
        assert g.formality is None
        assert g.tags == []

    def test_missing_required_fields_raises(self):
        with pytest.raises(ValidationError):
            GarmentItem(id="1", user_id="u1")

    def test_invalid_category_string(self):
        with pytest.raises(ValidationError):
            GarmentItem(
                id="1",
                user_id="u1",
                primary_image_url="https://example.com/img.jpg",
                category="invalid_cat",
                created_at=_NOW,
                updated_at=_NOW,
            )

    def test_optional_fields_default_none(self):
        g = GarmentItem(
            id="1",
            user_id="u1",
            primary_image_url="https://example.com/img.jpg",
            category=GarmentCategory.DRESS,
            created_at=_NOW,
            updated_at=_NOW,
        )
        assert g.sub_category is None
        assert g.brand is None
        assert g.color_primary is None


class TestWeekEvent:
    def test_valid_event(self):
        e = WeekEvent(day="Monday", event_type="work_meeting")
        assert e.day == "Monday"
        assert e.location is None

    def test_with_optional_location(self):
        e = WeekEvent(day="Friday", event_type="date_night", location="NYC")
        assert e.location == "NYC"


class TestMediaIngestionJob:
    def test_defaults(self):
        j = MediaIngestionJob(
            id="j1",
            user_id="u1",
            media_type=MediaType.IMAGE_BATCH,
            source_uri="gs://bucket/file",
            created_at=_NOW,
            updated_at=_NOW,
        )
        assert j.status == MediaIngestionStatus.PENDING
        assert j.progress == 0.0


class TestWeekRecommendationRequest:
    def test_valid_request(self):
        r = WeekRecommendationRequest(
            user_id="u1",
            events=[WeekEvent(day="Monday", event_type="gym")],
        )
        assert len(r.events) == 1

    def test_empty_events_allowed(self):
        r = WeekRecommendationRequest(user_id="u1", events=[])
        assert r.events == []


class TestDayOutfitSuggestion:
    def test_all_optional_ids(self):
        s = DayOutfitSuggestion(
            day="Monday",
            event_type="gym",
            explanation="Go for it",
        )
        assert s.top_id is None
        assert s.bottom_id is None


class TestEnumValues:
    def test_garment_categories(self):
        values = [c.value for c in GarmentCategory]
        assert "top" in values
        assert "bottom" in values
        assert "dress" in values

    def test_formality_levels(self):
        values = [f.value for f in GarmentFormality]
        assert "casual" in values
        assert "formal" in values
        assert "smart_casual" in values

    def test_seasonality_options(self):
        values = [s.value for s in GarmentSeasonality]
        assert "hot" in values
        assert "all_season" in values
