"""Unit tests for wardrobe gap detection."""

from __future__ import annotations

from datetime import datetime

from backend.models import GarmentCategory, GarmentFormality, GarmentItem, GarmentSeasonality, WeekEvent, build_garment_tags
from backend.wardrobe_gaps import (
    build_shop_query,
    detect_gaps,
    wardrobe_inventory_summary,
    week_event_weights,
)


def _item(
    *,
    category: GarmentCategory,
    formality: GarmentFormality | None = None,
    sub: str | None = None,
    color: str | None = None,
) -> GarmentItem:
    now = datetime.utcnow()
    tags = build_garment_tags(category, formality, GarmentSeasonality.ALL_SEASON)
    return GarmentItem(
        id=f"id-{category.value}-{sub or 'x'}",
        user_id="u",
        primary_image_url="https://example.com/i.jpg",
        category=category,
        sub_category=sub,
        formality=formality,
        seasonality=GarmentSeasonality.ALL_SEASON,
        color_primary=color,
        tags=tags,
        created_at=now,
        updated_at=now,
    )


class TestInventorySummary:
    def test_counts_shoes_and_formal_shoes(self):
        items = [
            _item(category=GarmentCategory.SHOES, formality=GarmentFormality.BUSINESS, color="black"),
            _item(category=GarmentCategory.SHOES, formality=GarmentFormality.CASUAL, color="red"),
        ]
        s = wardrobe_inventory_summary(items)
        assert s.shoe_count == 2
        assert s.formal_shoe_count == 1
        assert s.neutral_shoe_count == 1


class TestWeekEventWeights:
    def test_normalizes_work_alias(self):
        ev = [
            WeekEvent(day="monday", event_type="work"),
            WeekEvent(day="tuesday", event_type="casual"),
        ]
        w = week_event_weights(ev)
        assert w.get("work_meeting") == 0.5


class TestDetectGaps:
    def test_outerwear_gap_when_none(self):
        items = [
            _item(category=GarmentCategory.TOP, formality=GarmentFormality.CASUAL),
            _item(category=GarmentCategory.BOTTOM, formality=GarmentFormality.CASUAL),
        ]
        s = wardrobe_inventory_summary(items)
        g = detect_gaps(s, {"work_meeting": 0.0})
        ids = {x.gap_id for x in g}
        assert "outerwear_layer" in ids

    def test_formal_shoes_when_work_heavy(self):
        items = [
            _item(category=GarmentCategory.TOP, formality=GarmentFormality.CASUAL),
            _item(category=GarmentCategory.BOTTOM, formality=GarmentFormality.CASUAL),
            _item(category=GarmentCategory.SHOES, formality=GarmentFormality.CASUAL, color="red"),
        ]
        s = wardrobe_inventory_summary(items)
        g = detect_gaps(s, {"work_meeting": 0.5})
        ids = [x.gap_id for x in g]
        assert "formal_shoes_work" in ids


class TestBuildShopQuery:
    def test_adds_gender_hint(self):
        from backend.models import UserProfile

        gap_list = detect_gaps(
            wardrobe_inventory_summary([]),
            {"work_meeting": 0.0},
        )
        gap = next(g for g in gap_list if g.gap_id == "neutral_shoes")
        profile = UserProfile(
            user_id="u",
            gender="female",
            updated_at=datetime.utcnow(),
        )
        q = build_shop_query(gap, profile, [])
        assert "women" in q.lower()
