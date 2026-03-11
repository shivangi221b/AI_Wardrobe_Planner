"""
recommendation.py — Outfit recommendation engine.

Garment selection is rules-based (formality matching + priority fallback).
Explanation generation is delegated to the LLM via ``backend.llm``.

Deliberately free of FastAPI imports so it can be unit-tested in isolation.
Weather/location logic is intentionally out of scope for the MVP; the WeekEvent
fields for those are accepted by the models but ignored here.
"""

from __future__ import annotations

from typing import Optional

from .llm import generate_outfit_explanation
from .models import DayOutfitSuggestion, GarmentItem, WeekEvent

# ---------------------------------------------------------------------------
# Category sets — checked against both category.value and sub_category
# ---------------------------------------------------------------------------

_TOP_CATEGORIES: frozenset[str] = frozenset(
    {"top", "shirt", "blouse", "sweater", "jacket", "activewear_top"}
)

_BOTTOM_CATEGORIES: frozenset[str] = frozenset(
    {"bottom", "pants", "jeans", "skirt", "activewear_bottom"}
)

# ---------------------------------------------------------------------------
# Formality preferences per event type
# "business" is treated as equivalent to "formal" for work contexts.
# Unknown event types fall back to casual.
# ---------------------------------------------------------------------------

_EVENT_FORMALITY: dict[str, frozenset[str]] = {
    "work_meeting": frozenset({"formal", "business"}),
    "date_night": frozenset({"smart_casual"}),
    "gym": frozenset({"casual"}),
    "casual": frozenset({"casual"}),
}

_FALLBACK_FORMALITY: frozenset[str] = frozenset({"casual"})

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _is_top(item: GarmentItem) -> bool:
    return (
        item.category.value in _TOP_CATEGORIES
        or (item.sub_category is not None and item.sub_category.lower() in _TOP_CATEGORIES)
    )


def _is_bottom(item: GarmentItem) -> bool:
    return (
        item.category.value in _BOTTOM_CATEGORIES
        or (item.sub_category is not None and item.sub_category.lower() in _BOTTOM_CATEGORIES)
    )


def _pick_garment(
    pool: list[GarmentItem],
    is_type_fn,  # callable: GarmentItem -> bool
    preferred_formalities: frozenset[str],
    used_ids: set[str],
) -> Optional[GarmentItem]:
    """
    Select the best garment from *pool* for the given type and formality.

    Selection priority:
      1. Unused garment matching category + preferred formality
      2. Unused garment matching category only (formality fallback)
      3. Already-used garment matching category + preferred formality
      4. Already-used garment matching category only
      5. None — category not present in wardrobe at all
    """
    matching_category = [g for g in pool if is_type_fn(g)]
    if not matching_category:
        return None

    def formality_matches(g: GarmentItem) -> bool:
        return g.formality is not None and g.formality.value in preferred_formalities

    unused = [g for g in matching_category if g.id not in used_ids]
    used = [g for g in matching_category if g.id in used_ids]

    unused_formal = [g for g in unused if formality_matches(g)]
    if unused_formal:
        return unused_formal[0]
    if unused:
        return unused[0]

    used_formal = [g for g in used if formality_matches(g)]
    if used_formal:
        return used_formal[0]
    return used[0]


def _display_name(item: Optional[GarmentItem]) -> Optional[str]:
    """Return a human-readable name for a garment, or None if item is absent."""
    if item is None:
        return None
    name = item.sub_category or item.category.value
    if item.brand:
        name = f"{item.brand} {name}"
    return name


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def generate_week_recommendations(
    wardrobe: list[GarmentItem],
    events: list[WeekEvent],
) -> list[DayOutfitSuggestion]:
    """
    Generate one :class:`DayOutfitSuggestion` per event in *events*.

    Garment selection is rules-based; explanation text is produced by the
    LLM (with garment images forwarded when available).

    Args:
        wardrobe: All garments belonging to the user. May be empty.
        events:   The user's week plan. Each entry describes one day.

    Returns:
        A list of :class:`DayOutfitSuggestion` objects in the same order as
        *events*.  Never raises — edge cases (empty wardrobe, unknown event
        type, missing category, LLM failure) produce graceful responses.
    """
    used_ids: set[str] = set()
    recommendations: list[DayOutfitSuggestion] = []

    for event in events:
        preferred = _EVENT_FORMALITY.get(event.event_type, _FALLBACK_FORMALITY)

        top = _pick_garment(wardrobe, _is_top, preferred, used_ids)
        bottom = _pick_garment(wardrobe, _is_bottom, preferred, used_ids)

        # LLM generates the explanation; garment image URLs are forwarded
        # inside generate_outfit_explanation when present.
        explanation = await generate_outfit_explanation(
            event.day, event.event_type, top, bottom
        )

        top_id = top.id if top else None
        bottom_id = bottom.id if bottom else None

        if top_id:
            used_ids.add(top_id)
        if bottom_id:
            used_ids.add(bottom_id)

        recommendations.append(
            DayOutfitSuggestion(
                day=event.day,
                event_type=event.event_type,
                top_id=top_id,
                bottom_id=bottom_id,
                top_name=_display_name(top) or "No item found",
                bottom_name=_display_name(bottom) or "No item found",
                explanation=explanation,
            )
        )

    return recommendations
