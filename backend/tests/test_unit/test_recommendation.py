"""Unit tests for the recommendation engine (backend.recommendation)."""

from __future__ import annotations

import pytest

from backend.models import (
    GarmentCategory,
    GarmentFormality,
    GarmentItem,
    WeekEvent,
)
from backend.recommendation import (
    _display_name,
    _is_bottom,
    _is_top,
    _pick_garment,
    generate_week_recommendations,
)


# -- helpers -----------------------------------------------------------------


class TestIsTop:
    def test_top_category(self, mock_wardrobe):
        top = next(g for g in mock_wardrobe if g.id == "g-top-formal")
        assert _is_top(top)

    def test_blouse_sub_category(self, mock_wardrobe):
        blouse = next(g for g in mock_wardrobe if g.id == "g-top-smart")
        assert _is_top(blouse)

    def test_bottom_not_top(self, mock_wardrobe):
        bottom = next(g for g in mock_wardrobe if g.id == "g-bottom-formal")
        assert not _is_top(bottom)


class TestIsBottom:
    def test_bottom_category(self, mock_wardrobe):
        bottom = next(g for g in mock_wardrobe if g.id == "g-bottom-formal")
        assert _is_bottom(bottom)

    def test_jeans_sub_category(self, mock_wardrobe):
        jeans = next(g for g in mock_wardrobe if g.id == "g-bottom-casual")
        assert _is_bottom(jeans)

    def test_top_not_bottom(self, mock_wardrobe):
        top = next(g for g in mock_wardrobe if g.id == "g-top-formal")
        assert not _is_bottom(top)


class TestPickGarment:
    def test_picks_unused_matching_formality(self, mock_wardrobe):
        result = _pick_garment(
            mock_wardrobe,
            _is_top,
            [frozenset({"formal"})],
            used_ids=set(),
        )
        assert result is not None
        assert result.id == "g-top-formal"

    def test_returns_none_when_no_formality_tier_matches(self, mock_wardrobe):
        result = _pick_garment(
            mock_wardrobe,
            _is_top,
            [frozenset({"nonexistent"})],
            used_ids=set(),
        )
        assert result is None

    def test_reuses_item_when_all_used(self, mock_wardrobe):
        top_ids = {g.id for g in mock_wardrobe if _is_top(g)}
        result = _pick_garment(
            mock_wardrobe,
            _is_top,
            [frozenset({"formal"})],
            used_ids=top_ids,
        )
        assert result is not None
        assert result.id in top_ids

    def test_returns_none_when_pool_empty(self, mock_wardrobe):
        result = _pick_garment(
            mock_wardrobe,
            lambda g: False,
            [frozenset({"casual"})],
            used_ids=set(),
        )
        assert result is None


class TestDisplayName:
    def test_returns_none_for_none_item(self):
        assert _display_name(None) is None

    def test_sub_category_preferred(self, mock_wardrobe):
        top = next(g for g in mock_wardrobe if g.id == "g-top-formal")
        name = _display_name(top)
        assert "shirt" in name.lower()

    def test_brand_included(self, mock_wardrobe):
        top = next(g for g in mock_wardrobe if g.id == "g-top-formal")
        name = _display_name(top)
        assert "Brooks Brothers" in name


# -- generate_week_recommendations ------------------------------------------


@pytest.mark.usefixtures("_mock_llm")
class TestGenerateWeekRecommendations:
    async def test_returns_one_recommendation_per_event(self, mock_wardrobe, mock_events):
        recs = await generate_week_recommendations(mock_wardrobe, mock_events)
        assert len(recs) == len(mock_events)

    async def test_empty_wardrobe_no_crash(self, mock_events):
        recs = await generate_week_recommendations([], mock_events)
        assert len(recs) == len(mock_events)
        for rec in recs:
            assert rec.top_name == "No item found"
            assert rec.bottom_name == "No item found"

    async def test_unknown_event_type_defaults_to_casual(self, mock_wardrobe):
        events = [WeekEvent(day="Monday", event_type="space_launch")]
        recs = await generate_week_recommendations(mock_wardrobe, events)
        assert len(recs) == 1
        assert recs[0].top_id is not None

    async def test_explanation_populated(self, mock_wardrobe, mock_events):
        recs = await generate_week_recommendations(mock_wardrobe, mock_events)
        for rec in recs:
            assert rec.explanation

    async def test_formality_matching_for_work(self, mock_wardrobe):
        events = [WeekEvent(day="Monday", event_type="work_meeting")]
        recs = await generate_week_recommendations(mock_wardrobe, events)
        rec = recs[0]
        if rec.top_id:
            top = next((g for g in mock_wardrobe if g.id == rec.top_id), None)
            assert top is not None
            assert top.formality in (GarmentFormality.FORMAL, GarmentFormality.BUSINESS)
