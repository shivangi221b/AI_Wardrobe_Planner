"""
recommendation.py — Outfit recommendation engine.

Garment selection is rules-based (formality chains + context filtering).
Explanation generation is delegated to the LLM via ``backend.llm``.

Deliberately free of FastAPI imports so it can be unit-tested in isolation.
Weather/location logic is intentionally out of scope for the MVP; the WeekEvent
fields for those are accepted by the models but ignored here.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from .llm import generate_outfit_explanation
from .models import BodyMeasurements, DayOutfitSuggestion, GarmentItem, LaundryStatus, UserProfile, WeekEvent

_RECENCY_PENALTY_DAYS = 3
_RECENCY_PENALTY_VALUE = 50
_NEGLECTED_BOOST_DAYS = 14
_NEGLECTED_BOOST_VALUE = -2

# ---------------------------------------------------------------------------
# Category sets — checked against both category.value and sub_category
# ---------------------------------------------------------------------------

_TOP_CATEGORIES: frozenset[str] = frozenset(
    {
        "top", "shirt", "blouse", "sweater", "t-shirt",
        "jacket", "activewear_top",
        "blazer", "vest", "halter_neck", "crop_top", "cardigan",
    }
)

_BOTTOM_CATEGORIES: frozenset[str] = frozenset(
    {
        "bottom", "pants", "jeans", "skirt", "activewear_bottom",
        "trousers", "shorts", "leggings", "culottes",
    }
)

# Explicit allowlists used to reject cross-category sub_category values.
_TOP_SUBCATEGORIES: frozenset[str] = frozenset(
    {
        "shirt", "blouse", "sweater", "t-shirt", "tank_top",
        "blazer", "vest", "jacket", "halter_neck", "activewear_top",
        "crop_top", "cardigan", "bodysuit", "hoodie", "polo",
        "turtleneck", "henley", "flannel", "sweatshirt",
    }
)

_BOTTOM_SUBCATEGORIES: frozenset[str] = frozenset(
    {
        "pants", "jeans", "trousers", "skirt", "shorts",
        "leggings", "activewear_bottom", "culottes", "chinos",
        "sweatpants", "cargo pants", "dress pants", "wide-leg pants",
    }
)

_DRESS_CATEGORIES: frozenset[str] = frozenset({"dress"})

# ---------------------------------------------------------------------------
# Formality — per-event-type fallback chains.
#
# Each chain is a list of formality tiers tried in order.  The engine stops
# at the first tier that yields a match.  If no tier matches the event gets
# None rather than a contextually inappropriate item.
# ---------------------------------------------------------------------------

_FORMALITY_FALLBACK_CHAINS: dict[str, list[frozenset[str]]] = {
    "work_meeting": [
        frozenset({"formal", "business"}),
        frozenset({"smart_casual"}),
        # No casual fallback — a tank top at a work meeting erodes trust.
    ],
    "date_night": [
        frozenset({"smart_casual"}),
        frozenset({"formal", "business"}),
        frozenset({"casual"}),
    ],
    "gym": [
        frozenset({"casual"}),
    ],
    "casual": [
        frozenset({"casual"}),
        frozenset({"smart_casual"}),
    ],
}

_FALLBACK_FORMALITY_CHAIN: list[frozenset[str]] = [
    frozenset({"casual"}),
    frozenset({"smart_casual"}),
]

# ---------------------------------------------------------------------------
# Sub-categories that are always excluded for specific event types.
# Checked against item.sub_category after normalization.
# ---------------------------------------------------------------------------

_EXCLUDED_SUBCATEGORIES_BY_EVENT: dict[str, frozenset[str]] = {
    "work_meeting": frozenset(
        {"tank_top", "crop_top", "graphic_tee", "halter_neck", "bodysuit", "hoodie"}
    ),
}


def _normalize_sub_category(value: str) -> str:
    """Normalize a sub_category string for comparison.

    Converts user-entered free-form values (e.g. ``"Tank top"``, ``"Crop-top"``)
    to the snake_case form used in the blocklists and allowlists
    (e.g. ``"tank_top"``, ``"crop_top"``).
    """
    import re
    return re.sub(r"[\s\-]+", "_", value.strip().lower())

# ---------------------------------------------------------------------------
# Size-band mapping — used to prefer items that are likely to fit.
# Keys are normalised size strings; value is the set of equivalent labels.
# ---------------------------------------------------------------------------

_SIZE_BANDS: list[frozenset[str]] = [
    frozenset({"xxs", "00", "0"}),
    frozenset({"xs", "2", "4", "6"}),
    frozenset({"s", "small", "8", "10"}),
    frozenset({"m", "medium", "12", "14"}),
    frozenset({"l", "large", "16", "18"}),
    frozenset({"xl", "x-large", "20", "22"}),
    frozenset({"xxl", "2xl", "24", "26"}),
    frozenset({"xxxl", "3xl", "28", "30"}),
]


def _derive_size_label(measurements: BodyMeasurements) -> Optional[str]:
    """
    Derive a generic size label (e.g. ``"s"`` / ``"m"`` / ``"l"``) from the
    largest available measurement.  Returns ``None`` when no measurements are set.

    Uses UK/EU women's sizing as a heuristic reference — close enough for
    soft preferential ranking (not strict exclusion).
    """
    # Prefer bust / chest measurement; fall back to waist.
    ref = measurements.chest_cm or measurements.waist_cm
    if ref is None:
        return None
    if ref <= 82:
        return "xs"
    if ref <= 86:
        return "s"
    if ref <= 90:
        return "m"
    if ref <= 96:
        return "l"
    if ref <= 104:
        return "xl"
    return "xxl"


def _size_band_index(label: str) -> int:
    """Return the band index for *label*, or -1 if not found."""
    norm = label.strip().lower()
    for i, band in enumerate(_SIZE_BANDS):
        if norm in band:
            return i
    return -1


def _size_matches(item: GarmentItem, user_size_label: str) -> bool:
    """True if the item's size is in the same band as the user's size label."""
    if not item.size:
        return False
    item_band = _size_band_index(item.size)
    user_band = _size_band_index(user_size_label)
    return item_band != -1 and user_band != -1 and item_band == user_band


# ---------------------------------------------------------------------------
# Colour-preference helpers
# ---------------------------------------------------------------------------

# Broad colour-family groupings used to map a garment's color_primary/secondary
# to warm or cool categories.  Kept intentionally loose — the goal is soft
# preference scoring, not hard exclusion.
_WARM_COLOR_FAMILIES: frozenset[str] = frozenset(
    {
        "red", "orange", "yellow", "gold", "amber", "coral", "rust",
        "terracotta", "brown", "beige", "tan", "camel", "sand",
        "cream", "ivory", "olive", "mustard", "peach", "salmon",
    }
)

_COOL_COLOR_FAMILIES: frozenset[str] = frozenset(
    {
        "blue", "navy", "indigo", "violet", "purple", "lilac", "lavender",
        "teal", "cyan", "turquoise", "mint", "green", "sage", "emerald",
        "grey", "gray", "silver", "white", "black",
    }
)

# Score modifiers (added to a base score of 0.0)
_COLOR_MATCH_BONUS = 0.5
_COLOR_AVOID_PENALTY = -2.0
_COLOR_TONE_BONUS = 0.2


def _color_words(color_str: Optional[str]) -> frozenset[str]:
    """Tokenise a colour string into normalised words for fuzzy matching."""
    if not color_str:
        return frozenset()
    import re
    return frozenset(re.split(r"[\s,/\-_]+", color_str.strip().lower()))


class _ColorPrefCtx:
    """
    Pre-computed colour preference data for a single ``_pick_garment`` call.

    Building ``avoid_words`` / ``fav_words`` once per call (rather than once
    per garment comparison) eliminates the O(n × |preferences|) rebuild cost
    that would otherwise occur for larger wardrobes.
    """

    __slots__ = ("avoid_words", "fav_words", "tone")

    def __init__(self, profile: Optional[UserProfile]) -> None:
        if profile is None:
            self.avoid_words: frozenset[str] = frozenset()
            self.fav_words: frozenset[str] = frozenset()
            self.tone: Optional[str] = None
        else:
            self.avoid_words = frozenset(
                w for c in (profile.avoided_colors or []) for w in _color_words(c)
            )
            self.fav_words = frozenset(
                w for c in (profile.favorite_colors or []) for w in _color_words(c)
            )
            self.tone = profile.color_tone.lower() if profile.color_tone else None

    def score(self, item: GarmentItem) -> float:
        """Return the colour preference score for *item* using precomputed token sets."""
        item_words = _color_words(item.color_primary) | _color_words(item.color_secondary)
        if not item_words:
            return 0.0
        sc = 0.0
        if self.avoid_words and item_words & self.avoid_words:
            sc += _COLOR_AVOID_PENALTY
        if self.fav_words and item_words & self.fav_words:
            sc += _COLOR_MATCH_BONUS
        if self.tone == "warm" and item_words & _WARM_COLOR_FAMILIES:
            sc += _COLOR_TONE_BONUS
        elif self.tone == "cool" and item_words & _COOL_COLOR_FAMILIES:
            sc += _COLOR_TONE_BONUS
        return sc


def _score_color_preference(item: GarmentItem, profile: Optional[UserProfile]) -> float:
    """
    Return a floating-point colour score for *item* given *profile*.

    Positive scores indicate colour preference alignment; negative scores
    indicate colours the user explicitly wants to avoid.  Returns 0.0 when
    no profile is provided or preferences are empty.

    .. note::
        This public helper re-creates token sets on every call.  Inside
        ``_pick_garment`` use :class:`_ColorPrefCtx` instead so token sets
        are computed only once per request.
    """
    return _ColorPrefCtx(profile).score(item)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _is_top(item: GarmentItem) -> bool:
    norm_sub = _normalize_sub_category(item.sub_category) if item.sub_category else None
    cat_matches = (
        item.category.value in _TOP_CATEGORIES
        or (norm_sub is not None and norm_sub in _TOP_CATEGORIES)
    )
    if not cat_matches:
        return False
    # Reject items whose sub_category belongs exclusively to the bottom slot.
    if norm_sub and norm_sub in _BOTTOM_SUBCATEGORIES:
        return False
    return True


def _is_bottom(item: GarmentItem) -> bool:
    norm_sub = _normalize_sub_category(item.sub_category) if item.sub_category else None
    cat_matches = (
        item.category.value in _BOTTOM_CATEGORIES
        or (norm_sub is not None and norm_sub in _BOTTOM_CATEGORIES)
    )
    if not cat_matches:
        return False
    # Reject items whose sub_category belongs exclusively to the top slot.
    if norm_sub and norm_sub in _TOP_SUBCATEGORIES:
        return False
    return True


def _is_excluded_for_event(item: GarmentItem, event_type: str) -> bool:
    """Return True if the item's sub_category is on the exclusion list for *event_type*."""
    blocklist = _EXCLUDED_SUBCATEGORIES_BY_EVENT.get(event_type)
    if not blocklist:
        return False
    if item.sub_category and _normalize_sub_category(item.sub_category) in blocklist:
        return True
    return False


def _is_dress(item: GarmentItem) -> bool:
    return (
        item.category.value in _DRESS_CATEGORIES
        or (item.sub_category is not None and item.sub_category.lower() in _DRESS_CATEGORIES)
    )


def _pick_garment(
    pool: list[GarmentItem],
    is_type_fn,  # callable: GarmentItem -> bool
    formality_chain: list[frozenset[str]],
    used_ids: set[str],
    event_type: str = "",
    user_size_label: Optional[str] = None,
    user_profile: Optional[UserProfile] = None,
) -> Optional[GarmentItem]:
    """
    Select the best garment from *pool* for the given type, formality chain,
    size preference, and colour preference.

    Selection priority (per formality tier, in chain order):
      For each tier:
        1. Unused, size-matched, not-avoided, event-appropriate   ← best
        2. Unused, size-matched, any colour                       ← size always beats colour
        3. Unused, not-avoided (no size match)
        4. Unused, any colour (last unused resort)
        5. Same four levels repeated for already-used items
      After exhausting all explicit tiers:
        6. Garments with formality=None (untagged) — treated as last resort.
      Final fallback:
        7. None — no appropriate garment found

    Colour scoring is computed once per call via :class:`_ColorPrefCtx` to
    avoid rebuilding token sets for every garment comparison.  Size matching
    always takes priority over colour avoidance — a correctly-sized
    avoided-colour item is preferred over a not-avoided item that doesn't fit.
    """
    candidates = [
        g for g in pool
        if is_type_fn(g) and not g.hidden_from_recommendations and not _is_excluded_for_event(g, event_type)
    ]
    if not candidates:
        return None

    # Build colour preference context once for this call.
    ctx = _ColorPrefCtx(user_profile)

    # Cache per-garment scores so the lambda in sort() and _best() each only
    # compute the score once.
    color_scores: dict[str, float] = {g.id: ctx.score(g) for g in candidates}

    today = date.today()
    recency_cutoff = today - timedelta(days=_RECENCY_PENALTY_DAYS)
    neglected_cutoff = today - timedelta(days=_NEGLECTED_BOOST_DAYS)

    def _recency_modifier(g: GarmentItem) -> int:
        if g.last_worn_date is not None and g.last_worn_date >= recency_cutoff:
            return _RECENCY_PENALTY_VALUE
        if g.last_worn_date is not None and g.last_worn_date < neglected_cutoff:
            return _NEGLECTED_BOOST_VALUE
        if g.last_worn_date is None:
            return _NEGLECTED_BOOST_VALUE
        return 0

    # Primary sort: variety (times_recommended + recency modifier asc);
    # tiebreak: colour score desc.
    candidates.sort(key=lambda g: (g.times_recommended + _recency_modifier(g), -color_scores[g.id]))

    def formality_matches(g: GarmentItem, tier: frozenset[str]) -> bool:
        return g.formality is not None and g.formality.value in tier

    def _best(items: list[GarmentItem]) -> Optional[GarmentItem]:
        """
        Return the best item from *items* respecting the size-first,
        colour-second priority order.
        """
        if not items:
            return None

        if user_size_label:
            # 1st priority: size-matched AND not-avoided
            sized_clean = [
                g for g in items
                if _size_matches(g, user_size_label) and color_scores[g.id] >= 0
            ]
            if sized_clean:
                return sized_clean[0]
            # 2nd priority: size-matched (even if avoided colour)
            sized_any = [g for g in items if _size_matches(g, user_size_label)]
            if sized_any:
                return sized_any[0]

        # No size preference or no size-matched item: prefer not-avoided colour.
        not_avoided = [g for g in items if color_scores[g.id] >= 0]
        if not_avoided:
            return not_avoided[0]
        return items[0]

    def _pick_from(subset: list[GarmentItem]) -> Optional[GarmentItem]:
        """Split *subset* into unused / in-use and pick from each in order."""
        if not subset:
            return None
        unused = [g for g in subset if g.id not in used_ids]
        in_use = [g for g in subset if g.id in used_ids]
        result = _best(unused)
        if result is not None:
            return result
        return _best(in_use)

    for tier in formality_chain:
        tier_candidates = [g for g in candidates if formality_matches(g, tier)]
        result = _pick_from(tier_candidates)
        if result is not None:
            return result

    # Fallback: items whose formality was never set (e.g. vision-ingested with
    # no recognized formality label).  Treated as context-neutral rather than
    # excluded outright.
    untagged = [g for g in candidates if g.formality is None]
    return _pick_from(untagged)


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
    user_gender: Optional[str] = None,
    measurements: Optional[BodyMeasurements] = None,
    user_profile: Optional[UserProfile] = None,
    include_laundry: bool = False,
) -> list[DayOutfitSuggestion]:
    """
    Generate one :class:`DayOutfitSuggestion` per event in *events*.

    Garment selection is rules-based; explanation text is produced by the
    LLM (with garment images forwarded when available).

    Args:
        wardrobe:        All garments belonging to the user. May be empty.
        events:          The user's week plan. Each entry describes one day.
        user_gender:     Optional gender string (``"male"``, ``"female"``, ``"other"``).
                         When set, garments tagged for the opposite binary gender are
                         excluded before selection begins.
        measurements:    Optional body measurements used for soft size-band scoring.
        user_profile:    Optional extended style profile used for colour preference
                         scoring (favourite/avoided colours and colour tone).
        include_laundry: When False (default), items with ``laundry_status == in_laundry``
                         are excluded from recommendations.

    Returns:
        A list of :class:`DayOutfitSuggestion` objects in the same order as
        *events*.  Never raises — edge cases (empty wardrobe, unknown event
        type, missing category, LLM failure) produce graceful responses.
    """
    # --- 0. Laundry pre-filter ---
    if not include_laundry:
        wardrobe = [g for g in wardrobe if g.laundry_status != LaundryStatus.IN_LAUNDRY]

    # --- 1. Gender pre-filter ---
    if user_gender:
        # Map user-facing gender strings to the garment gender enum values.
        _USER_TO_GARMENT_GENDER = {
            "male": "men",
            "female": "women",
        }
        target = _USER_TO_GARMENT_GENDER.get(user_gender.lower())
        opposite = {"men": "women", "women": "men"}.get(target or "") if target else None
        if opposite:
            wardrobe = [
                g for g in wardrobe
                if g.gender is None or g.gender.value != opposite
            ]

    # --- 2. Hidden-item pre-filter ---
    wardrobe = [g for g in wardrobe if not g.hidden_from_recommendations]

    # --- 3. Derive user size label for soft scoring ---
    user_size_label: Optional[str] = None
    if measurements:
        user_size_label = _derive_size_label(measurements)

    used_ids: set[str] = set()
    recommendations: list[DayOutfitSuggestion] = []

    for event in events:
        formality_chain = _FORMALITY_FALLBACK_CHAINS.get(
            event.event_type, _FALLBACK_FORMALITY_CHAIN
        )

        top = _pick_garment(
            wardrobe, _is_top, formality_chain, used_ids,
            event_type=event.event_type,
            user_size_label=user_size_label,
            user_profile=user_profile,
        )
        bottom = _pick_garment(
            wardrobe, _is_bottom, formality_chain, used_ids,
            event_type=event.event_type,
            user_size_label=user_size_label,
            user_profile=user_profile,
        )

        # If top or bottom is missing, try a dress as a fallback
        dress = None
        if top is None or bottom is None:
            dress = _pick_garment(
                wardrobe, _is_dress, formality_chain, used_ids,
                event_type=event.event_type,
                user_size_label=user_size_label,
                user_profile=user_profile,
            )

        if dress is not None and (top is None or bottom is None):
            explanation = await generate_outfit_explanation(
                event.day, event.event_type, dress, None
            )
            if dress.id:
                used_ids.add(dress.id)
            recommendations.append(
                DayOutfitSuggestion(
                    day=event.day,
                    event_type=event.event_type,
                    dress_id=dress.id,
                    dress_name=_display_name(dress) or "No item found",
                    top_name="No item found",
                    bottom_name="No item found",
                    explanation=explanation,
                )
            )
        else:
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
