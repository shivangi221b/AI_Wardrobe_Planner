"""Unit tests for the recommendation engine (backend.recommendation)."""

from __future__ import annotations

import pytest

from backend.models import (
    GarmentCategory,
    GarmentFormality,
    GarmentItem,
    UserProfile,
    WeekEvent,
    build_garment_tags,
)
from backend.recommendation import (
    _ColorPrefCtx,
    _display_name,
    _is_bottom,
    _is_top,
    _pick_garment,
    _score_color_preference,
    generate_week_recommendations,
)
from datetime import datetime, timezone

_NOW = datetime(2026, 4, 14, 12, 0, 0, tzinfo=timezone.utc)


def _make_top(
    id: str,
    color: str | None,
    formality: GarmentFormality = GarmentFormality.CASUAL,
    size: str | None = None,
) -> GarmentItem:
    tags = build_garment_tags(GarmentCategory.TOP, formality)
    return GarmentItem(
        id=id,
        user_id="u1",
        primary_image_url="https://x.com/img.jpg",
        category=GarmentCategory.TOP,
        sub_category="shirt",
        formality=formality,
        color_primary=color,
        size=size,
        tags=tags,
        created_at=_NOW,
        updated_at=_NOW,
    )


def _profile(
    favorite_colors: list[str] | None = None,
    avoided_colors: list[str] | None = None,
    color_tone: str | None = None,
) -> UserProfile:
    return UserProfile(
        user_id="u1",
        favorite_colors=favorite_colors or [],
        avoided_colors=avoided_colors or [],
        color_tone=color_tone,
        updated_at=_NOW,
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


# -- Colour preference scoring ----------------------------------------------


class TestColorPrefCtx:
    def test_no_profile_zero_score(self):
        ctx = _ColorPrefCtx(None)
        item = _make_top("t1", "red")
        assert ctx.score(item) == 0.0

    def test_avoided_color_penalty(self):
        ctx = _ColorPrefCtx(_profile(avoided_colors=["red"]))
        item = _make_top("t1", "red")
        assert ctx.score(item) < 0

    def test_favorite_color_bonus(self):
        ctx = _ColorPrefCtx(_profile(favorite_colors=["navy"]))
        item = _make_top("t1", "navy")
        assert ctx.score(item) > 0

    def test_warm_tone_bonus(self):
        ctx = _ColorPrefCtx(_profile(color_tone="warm"))
        item = _make_top("t1", "rust")
        assert ctx.score(item) > 0

    def test_cool_tone_bonus(self):
        ctx = _ColorPrefCtx(_profile(color_tone="cool"))
        item = _make_top("t1", "teal")
        assert ctx.score(item) > 0

    def test_no_color_on_item_zero_score(self):
        ctx = _ColorPrefCtx(_profile(favorite_colors=["blue"]))
        item = _make_top("t1", None)
        assert ctx.score(item) == 0.0

    def test_score_color_preference_public_helper(self):
        p = _profile(avoided_colors=["yellow"])
        item = _make_top("t1", "yellow")
        assert _score_color_preference(item, p) < 0


class TestPickGarmentColourPriority:
    """Verify the size-first, colour-second selection order."""

    def test_avoided_colours_deprioritised_when_alternative_exists(self):
        avoided = _make_top("avoided", "red", GarmentFormality.CASUAL)
        clean = _make_top("clean", "navy", GarmentFormality.CASUAL)
        profile = _profile(avoided_colors=["red"])
        result = _pick_garment(
            [avoided, clean],
            _is_top,
            [frozenset({"casual"})],
            used_ids=set(),
            user_profile=profile,
        )
        assert result is not None
        assert result.id == "clean"

    def test_avoided_item_returned_when_it_is_only_option(self):
        avoided = _make_top("avoided", "red", GarmentFormality.CASUAL)
        profile = _profile(avoided_colors=["red"])
        result = _pick_garment(
            [avoided],
            _is_top,
            [frozenset({"casual"})],
            used_ids=set(),
            user_profile=profile,
        )
        assert result is not None
        assert result.id == "avoided"

    def test_favourite_colour_preferred_as_tiebreak(self):
        # Both items same formality, same times_recommended; fav colour wins.
        plain = _make_top("plain", "grey", GarmentFormality.CASUAL)
        fav = _make_top("fav", "navy", GarmentFormality.CASUAL)
        profile = _profile(favorite_colors=["navy"])
        result = _pick_garment(
            [plain, fav],
            _is_top,
            [frozenset({"casual"})],
            used_ids=set(),
            user_profile=profile,
        )
        assert result is not None
        assert result.id == "fav"

    def test_sized_item_beats_avoided_colour_unsized(self):
        """Size match trumps colour preference — a sized avoided item is preferred
        over a not-avoided item that doesn't match the user's size."""
        sized_avoided = _make_top("sized_avoided", "red", GarmentFormality.CASUAL, size="m")
        unsized_clean = _make_top("unsized_clean", "navy", GarmentFormality.CASUAL, size=None)
        profile = _profile(avoided_colors=["red"])
        result = _pick_garment(
            [sized_avoided, unsized_clean],
            _is_top,
            [frozenset({"casual"})],
            used_ids=set(),
            user_size_label="m",
            user_profile=profile,
        )
        # The sized item should win even though its colour is avoided.
        assert result is not None
        assert result.id == "sized_avoided"

    def test_sized_clean_beats_sized_avoided(self):
        """When there is a sized AND not-avoided option, it should win."""
        sized_avoided = _make_top("sized_avoided", "red", GarmentFormality.CASUAL, size="m")
        sized_clean = _make_top("sized_clean", "navy", GarmentFormality.CASUAL, size="m")
        profile = _profile(avoided_colors=["red"])
        result = _pick_garment(
            [sized_avoided, sized_clean],
            _is_top,
            [frozenset({"casual"})],
            used_ids=set(),
            user_size_label="m",
            user_profile=profile,
        )
        assert result is not None
        assert result.id == "sized_clean"
