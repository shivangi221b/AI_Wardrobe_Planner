"""
Wardrobe gap taxonomy & detection (Shop to Complete Your Wardrobe).

Gap types are aligned with ``recommendation.py``:

- ``work_meeting`` uses formality chains ``formal``/``business`` then ``smart_casual``;
  missing **business/formal shoes** or **work-appropriate layering** blocks polished outfits.
- ``outerwear`` category fills cold-weather and layering needs.
- **Neutral shoes** increase mix-and-match; detected when no versatile shoe colors exist.
- **Accessories** (category ``accessory``) are suggested when the closet is large but
  accessory count is very low (optional signal).

Each gap maps to a :class:`GarmentCategory` and optional :class:`GarmentFormality` used
when the user marks an item purchased (inserted as a :class:`GarmentItem`).
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import Any, Optional

from .models import (
    GarmentCategory,
    GarmentFormality,
    GarmentItem,
    UserProfile,
)


def _normalize_sub_category(value: str) -> str:
    return re.sub(r"[\s\-]+", "_", value.strip().lower())


_NEUTRAL_COLOR_TOKENS: frozenset[str] = frozenset(
    {
        "black", "navy", "white", "off", "ivory", "cream", "beige", "tan", "camel",
        "brown", "grey", "gray", "charcoal", "taupe", "nude", "khaki", "bone",
    }
)

_FORMAL_SHOE_FORMALITIES: frozenset[str] = frozenset({"business", "formal"})

_LAYERING_SUBS: frozenset[str] = frozenset(
    {"blazer", "cardigan", "sport_coat", "sport", "coat", "trench", "peacoat", "vest"}
)


@dataclass
class WardrobeInventorySummary:
    """Aggregated signals from the user's garments (non-hidden only)."""

    total_items: int
    by_category: dict[str, int]
    shoe_count: int
    outerwear_count: int
    accessory_count: int
    dress_count: int
    formal_shoe_count: int
    neutral_shoe_count: int
    work_formal_top_count: int
    layering_piece_count: int
    brand_counts: dict[str, int]
    has_neutral_bottom: bool


def _visible(g: GarmentItem) -> bool:
    return not g.hidden_from_recommendations


def _color_tokens(item: GarmentItem) -> frozenset[str]:
    words: set[str] = set()
    for c in (item.color_primary, item.color_secondary):
        if not c:
            continue
        words.update(re.split(r"[\s,/\-_]+", c.strip().lower()))
    return frozenset(w for w in words if w)


def _is_neutral_garment(item: GarmentItem) -> bool:
    tokens = _color_tokens(item)
    if not tokens:
        return False
    return bool(tokens & _NEUTRAL_COLOR_TOKENS)


def wardrobe_inventory_summary(garments: list[GarmentItem]) -> WardrobeInventorySummary:
    visible = [g for g in garments if _visible(g)]
    by_cat: Counter[str] = Counter()
    brand_counts: Counter[str] = Counter()
    shoe_count = outerwear_count = accessory_count = dress_count = 0
    formal_shoe_count = neutral_shoe_count = 0
    work_formal_top_count = layering_piece_count = 0
    neutral_bottom = False

    for g in visible:
        by_cat[g.category.value] += 1
        if g.brand and g.brand.strip():
            brand_counts[g.brand.strip().lower()] += 1

        if g.category == GarmentCategory.SHOES:
            shoe_count += 1
            if g.formality and g.formality.value in _FORMAL_SHOE_FORMALITIES:
                formal_shoe_count += 1
            if _is_neutral_garment(g):
                neutral_shoe_count += 1
        elif g.category == GarmentCategory.OUTERWEAR:
            outerwear_count += 1
            sub = _normalize_sub_category(g.sub_category) if g.sub_category else ""
            if sub in _LAYERING_SUBS or "blazer" in sub or "cardigan" in sub:
                layering_piece_count += 1
        elif g.category == GarmentCategory.ACCESSORY:
            accessory_count += 1
        elif g.category == GarmentCategory.DRESS:
            dress_count += 1
        elif g.category == GarmentCategory.TOP:
            sub = _normalize_sub_category(g.sub_category) if g.sub_category else ""
            if sub in _LAYERING_SUBS or sub == "blazer" or sub == "cardigan":
                layering_piece_count += 1
            if g.formality and g.formality.value in ("business", "formal", "smart_casual"):
                work_formal_top_count += 1
        elif g.category == GarmentCategory.BOTTOM:
            if _is_neutral_garment(g):
                neutral_bottom = True

    return WardrobeInventorySummary(
        total_items=len(visible),
        by_category=dict(by_cat),
        shoe_count=shoe_count,
        outerwear_count=outerwear_count,
        accessory_count=accessory_count,
        dress_count=dress_count,
        formal_shoe_count=formal_shoe_count,
        neutral_shoe_count=neutral_shoe_count,
        work_formal_top_count=work_formal_top_count,
        layering_piece_count=layering_piece_count,
        brand_counts=dict(brand_counts),
        has_neutral_bottom=neutral_bottom,
    )


def infer_preferred_brands(summary: WardrobeInventorySummary, limit: int = 5) -> list[str]:
    """Most common brands in the wardrobe (lowercased keys → title-case display)."""
    pairs = sorted(summary.brand_counts.items(), key=lambda x: -x[1])[:limit]
    out: list[str] = []
    for key, _ in pairs:
        out.append(key.title())
    return out


def week_event_weights(events: list[Any]) -> dict[str, float]:
    """
    Normalise stored week events to the same ``event_type`` vocabulary as
    ``recommendation._FORMALITY_FALLBACK_CHAINS`` and return fractional weights.
    """
    if not events:
        return {}
    counts: Counter[str] = Counter()
    for e in events:
        raw = (getattr(e, "event_type", None) or "casual").strip().lower()
        if raw in ("work", "office", "business"):
            raw = "work_meeting"
        if raw == "date":
            raw = "date_night"
        counts[raw] += 1
    total = sum(counts.values())
    if total <= 0:
        return {}
    return {k: v / total for k, v in counts.items()}


@dataclass
class DetectedGap:
    gap_id: str
    title: str
    reason: str
    target_category: GarmentCategory
    target_formality: Optional[GarmentFormality]
    suggested_name: str
    query_seed: str
    priority: int


def detect_gaps(
    summary: WardrobeInventorySummary,
    weights: dict[str, float],
) -> list[DetectedGap]:
    """
    Deterministic gap list. Higher *priority* sorts first (importance).
    """
    work_share = float(weights.get("work_meeting", 0.0))
    gaps: list[DetectedGap] = []

    # 1) Work-appropriate shoes when calendar is work-heavy
    if work_share >= 0.2 and summary.formal_shoe_count == 0 and summary.shoe_count < 3:
        gaps.append(
            DetectedGap(
                gap_id="formal_shoes_work",
                title="Business-appropriate shoes",
                reason="Your week includes several work meetings; formal or business shoes unlock polished outfits.",
                target_category=GarmentCategory.SHOES,
                target_formality=GarmentFormality.BUSINESS,
                suggested_name="Leather loafers",
                query_seed="leather loafers business casual",
                priority=100,
            )
        )

    # 2) Neutral versatile shoes
    if summary.shoe_count == 0 or (summary.shoe_count > 0 and summary.neutral_shoe_count == 0):
        gaps.append(
            DetectedGap(
                gap_id="neutral_shoes",
                title="Neutral everyday shoes",
                reason="Black, white, or tan shoes pair with more of what you already own.",
                target_category=GarmentCategory.SHOES,
                target_formality=GarmentFormality.SMART_CASUAL,
                suggested_name="White sneakers",
                query_seed="white leather sneakers minimal",
                priority=90,
            )
        )

    # 3) Outerwear
    if summary.outerwear_count == 0:
        gaps.append(
            DetectedGap(
                gap_id="outerwear_layer",
                title="Versatile jacket or coat",
                reason="A neutral outer layer extends outfits across seasons.",
                target_category=GarmentCategory.OUTERWEAR,
                target_formality=GarmentFormality.SMART_CASUAL,
                suggested_name="Trench or wool coat",
                query_seed="trench coat camel women classic",
                priority=85,
            )
        )

    # 4) Work layering (blazer / cardigan) when work-heavy and no layering pieces
    if work_share >= 0.25 and summary.layering_piece_count == 0:
        gaps.append(
            DetectedGap(
                gap_id="work_layering_blazer",
                title="Blazer or structured layer",
                reason="Meetings often need a smart layer over tops that are otherwise casual.",
                target_category=GarmentCategory.TOP,
                target_formality=GarmentFormality.BUSINESS,
                suggested_name="Navy blazer",
                query_seed="navy blazer women tailored",
                priority=88,
            )
        )

    # 5) Accessories for larger wardrobes
    if summary.total_items >= 12 and summary.accessory_count < 2:
        gaps.append(
            DetectedGap(
                gap_id="accessories_versatile",
                title="Simple accessories",
                reason="A few go-to accessories add polish without new outfits.",
                target_category=GarmentCategory.ACCESSORY,
                target_formality=GarmentFormality.SMART_CASUAL,
                suggested_name="Gold hoop earrings",
                query_seed="gold hoop earrings classic",
                priority=55,
            )
        )

    # 6) Neutral bottom if many colorful tops but no neutral pants
    tops = summary.by_category.get("top", 0)
    bottoms = summary.by_category.get("bottom", 0)
    if tops >= 3 and bottoms >= 1 and not summary.has_neutral_bottom:
        gaps.append(
            DetectedGap(
                gap_id="neutral_bottom",
                title="Neutral pants or skirt",
                reason="A black, navy, or beige bottom anchors loud tops and patterns.",
                target_category=GarmentCategory.BOTTOM,
                target_formality=GarmentFormality.SMART_CASUAL,
                suggested_name="Black straight-leg pants",
                query_seed="black straight leg pants women",
                priority=70,
            )
        )

    gaps.sort(key=lambda g: -g.priority)
    # De-duplicate by gap_id while preserving order
    seen: set[str] = set()
    unique: list[DetectedGap] = []
    for g in gaps:
        if g.gap_id not in seen:
            seen.add(g.gap_id)
            unique.append(g)
    return unique[:8]


def _tokenize_prefs(colors: list[str]) -> frozenset[str]:
    words: set[str] = set()
    for c in colors:
        if not c:
            continue
        words.update(re.split(r"[\s,/\-_#]+", c.strip().lower()))
    return frozenset(w for w in words if len(w) > 1)


def build_shop_query(
    gap: DetectedGap,
    profile: Optional[UserProfile],
    inferred_brands: list[str],
) -> str:
    """Compose a shopping search string from gap + user preferences."""
    parts: list[str] = [gap.query_seed]

    gender_hint = ""
    if profile and profile.gender:
        g = profile.gender.lower()
        if g == "female":
            gender_hint = "women"
        elif g == "male":
            gender_hint = "men"
    if gender_hint:
        parts.append(gender_hint)

    brands: list[str] = []
    if profile and profile.favorite_brands:
        brands.extend(profile.favorite_brands[:2])
    brands.extend(inferred_brands[:1])
    for b in brands:
        b = (b or "").strip()
        if b and b.lower() not in " ".join(parts).lower():
            parts.append(b)
            break

    if profile and profile.favorite_colors:
        fav = list(profile.favorite_colors)[:1]
        avoid_words = _tokenize_prefs(profile.avoided_colors or [])
        for c in fav:
            tok = (c or "").strip()
            if not tok:
                continue
            low = tok.lower()
            if low in avoid_words:
                continue
            if low not in " ".join(parts).lower():
                parts.append(tok)
                break

    q = " ".join(p for p in parts if p)
    if profile and profile.avoided_colors:
        # Soft exclusion: trim tokens that match avoided palette
        avoid = _tokenize_prefs(profile.avoided_colors)
        tokens = q.split()
        tokens = [t for t in tokens if t.lower() not in avoid]
        q = " ".join(tokens)
    return q.strip()


def gaps_to_llm_payload(
    summary: WardrobeInventorySummary,
    weights: dict[str, float],
    gaps: list[DetectedGap],
) -> str:
    """Compact JSON-serialisable description for optional LLM ranker."""
    import json

    payload = {
        "inventory": {
            "total": summary.total_items,
            "shoes": summary.shoe_count,
            "formal_shoes": summary.formal_shoe_count,
            "outerwear": summary.outerwear_count,
            "accessories": summary.accessory_count,
        },
        "week_weights": weights,
        "gaps": [
            {
                "gap_id": g.gap_id,
                "title": g.title,
                "reason": g.reason,
                "priority": g.priority,
            }
            for g in gaps
        ],
    }
    return json.dumps(payload, ensure_ascii=False)
