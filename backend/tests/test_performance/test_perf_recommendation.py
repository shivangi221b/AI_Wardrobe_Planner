"""Performance tests for the recommendation engine."""

from __future__ import annotations

import time
from datetime import datetime, timezone

import pytest

from backend.models import (
    GarmentCategory,
    GarmentFormality,
    GarmentItem,
    GarmentSeasonality,
    WeekEvent,
    build_garment_tags,
)
from backend.recommendation import generate_week_recommendations

_NOW = datetime(2026, 4, 14, 12, 0, 0, tzinfo=timezone.utc)

_CATEGORIES = list(GarmentCategory)
_FORMALITIES = list(GarmentFormality)


def _make_large_wardrobe(n: int) -> list[GarmentItem]:
    items = []
    for i in range(n):
        cat = _CATEGORIES[i % len(_CATEGORIES)]
        form = _FORMALITIES[i % len(_FORMALITIES)]
        tags = build_garment_tags(cat, form)
        items.append(
            GarmentItem(
                id=f"perf-{i}",
                user_id="perf-user",
                primary_image_url=f"https://example.com/{i}.jpg",
                category=cat,
                sub_category=f"item-{i}",
                formality=form,
                tags=tags,
                created_at=_NOW,
                updated_at=_NOW,
            )
        )
    return items


@pytest.mark.usefixtures("_mock_llm")
class TestRecommendationPerformance:
    async def test_500_garment_wardrobe_under_2s(self):
        wardrobe = _make_large_wardrobe(500)
        events = [
            WeekEvent(day=d, event_type=et)
            for d, et in [
                ("Monday", "work_meeting"),
                ("Tuesday", "gym"),
                ("Wednesday", "casual"),
                ("Thursday", "work_meeting"),
                ("Friday", "date_night"),
                ("Saturday", "casual"),
                ("Sunday", "casual"),
            ]
        ]

        start = time.perf_counter()
        recs = await generate_week_recommendations(wardrobe, events)
        elapsed = time.perf_counter() - start

        assert len(recs) == 7
        assert elapsed < 2.0, f"Recommendation took {elapsed:.2f}s with 500 garments (limit: 2s)"

    async def test_1000_garment_wardrobe_under_5s(self):
        wardrobe = _make_large_wardrobe(1000)
        events = [WeekEvent(day="Monday", event_type="work_meeting")]

        start = time.perf_counter()
        recs = await generate_week_recommendations(wardrobe, events)
        elapsed = time.perf_counter() - start

        assert len(recs) == 1
        assert elapsed < 5.0, f"Recommendation took {elapsed:.2f}s with 1000 garments (limit: 5s)"

    async def test_empty_wardrobe_fast(self):
        events = [
            WeekEvent(day=d, event_type="casual")
            for d in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        ]

        start = time.perf_counter()
        recs = await generate_week_recommendations([], events)
        elapsed = time.perf_counter() - start

        assert len(recs) == 7
        assert elapsed < 1.0, f"Empty wardrobe took {elapsed:.2f}s (limit: 1s)"
