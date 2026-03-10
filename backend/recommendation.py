"""
recommendation.py — Pure rules-based outfit recommendation engine.

Deliberately free of FastAPI imports so it can be unit-tested in isolation.
Weather/location logic is intentionally out of scope for the MVP; the WeekEvent
fields for those are accepted by the models but ignored here.
"""

from __future__ import annotations

from typing import Optional

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
# Explanation templates
# ---------------------------------------------------------------------------

_EXPLANATION_TEMPLATES: dict[str, str] = {
    "work_meeting": (
        "For your {day} work meeting, we picked a {top_name} and {bottom_name} "
        "from your wardrobe to keep you polished and professional."
    ),
    "date_night": (
        "For your {day} date night, we went with a smart-casual {top_name} and "
        "{bottom_name} to keep things stylish yet relaxed."
    ),
    "gym": (
        "Keeping it comfortable for your {day} gym session — a {top_name} and "
        "{bottom_name} to keep you moving."
    ),
    "casual": (
        "Casual and easy for {day} — a {top_name} paired with {bottom_name} "
        "for a no-fuss look."
    ),
}

_MISSING_TEMPLATE = (
    "We couldn't find a perfect match for your {day} {event_type} — "
    "consider adding more items to your wardrobe."
)


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

    # Priority 1 & 2 — prefer unused
    unused_formal = [g for g in unused if formality_matches(g)]
    if unused_formal:
        return unused_formal[0]
    if unused:
        return unused[0]

    # Priority 3 & 4 — allow repeat if no unused option
    used_formal = [g for g in used if formality_matches(g)]
    if used_formal:
        return used_formal[0]
    return used[0]


def _build_explanation(
    day: str,
    event_type: str,
    top_name: Optional[str],
    bottom_name: Optional[str],
) -> str:
    missing = top_name is None or bottom_name is None
    if missing:
        return _MISSING_TEMPLATE.format(day=day, event_type=event_type)

    template = _EXPLANATION_TEMPLATES.get(event_type, _EXPLANATION_TEMPLATES["casual"])
    return template.format(day=day, top_name=top_name, bottom_name=bottom_name)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def generate_week_recommendations(
    wardrobe: list[GarmentItem],
    events: list[WeekEvent],
) -> list[DayOutfitSuggestion]:
    """
    Generate one :class:`DayRecommendation` per event in *events*.

    Args:
        wardrobe: All garments belonging to the user. May be empty.
        events:   The user's week plan. Each entry describes one day.

    Returns:
        A list of :class:`DayOutfitSuggestion` objects in the same order as
        *events*.  Never raises — edge cases (empty wardrobe, unknown event
        type, missing category) produce graceful "No item found" responses.
    """
    used_ids: set[str] = set()
    recommendations: list[DayOutfitSuggestion] = []

    for event in events:
        preferred = _EVENT_FORMALITY.get(event.event_type, _FALLBACK_FORMALITY)

        top = _pick_garment(wardrobe, _is_top, preferred, used_ids)
        bottom = _pick_garment(wardrobe, _is_bottom, preferred, used_ids)

        top_id = top.id if top else None
        top_name = top.sub_category or top.category.value if top else None
        if top and top.brand:
            top_name = f"{top.brand} {top_name}"

        bottom_id = bottom.id if bottom else None
        bottom_name = bottom.sub_category or bottom.category.value if bottom else None
        if bottom and bottom.brand:
            bottom_name = f"{bottom.brand} {bottom_name}"

        explanation = _build_explanation(event.day, event.event_type, top_name, bottom_name)

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
                top_name=top_name or "No item found",
                bottom_name=bottom_name or "No item found",
                explanation=explanation,
            )
        )

    return recommendations
