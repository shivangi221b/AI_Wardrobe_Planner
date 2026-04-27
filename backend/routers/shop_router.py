"""
Shop to Complete Your Wardrobe — gap detection + product options + engagement.
"""

from __future__ import annotations

import logging
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import get_wardrobe, get_user_profile, insert_garment, insert_shop_engagement_event
from ..llm import rank_shop_gap_ids
from ..models import (
    GarmentItem,
    GarmentFormality,
    GarmentSeasonality,
    ShopEventRequest,
    ShopMarkPurchasedRequest,
    ShopSuggestionsResponse,
    WardrobeGapSuggestion,
    build_garment_tags,
)
from ..shop_products import search_products_cached
from ..storage import get_week_events
from ..wardrobe_gaps import (
    DetectedGap,
    build_shop_query,
    detect_gaps,
    gaps_to_llm_payload,
    infer_preferred_brands,
    wardrobe_inventory_summary,
    week_event_weights,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["shop"])

_ALLOWED_EVENTS = frozenset({"impression", "click", "dismiss", "add_to_wardrobe"})


class ShopEventAck(BaseModel):
    ok: bool = True


def _reorder_gaps(
    gaps: list[DetectedGap],
    ordered_ids: list[str] | None,
) -> list[DetectedGap]:
    if not ordered_ids:
        return gaps
    id_set = {g.gap_id for g in gaps}
    merged: list[str] = []
    for i in ordered_ids:
        if i in id_set and i not in merged:
            merged.append(i)
    for g in gaps:
        if g.gap_id not in merged:
            merged.append(g.gap_id)
    if set(merged) != id_set:
        logger.warning("shop_llm_rank ignored: invalid id set")
        return gaps
    m = {g.gap_id: g for g in gaps}
    return [m[i] for i in merged]


@router.get("/{user_id}/shop/suggestions", response_model=ShopSuggestionsResponse)
async def get_shop_suggestions(user_id: str) -> ShopSuggestionsResponse:
    wardrobe = get_wardrobe(user_id)
    profile = get_user_profile(user_id)
    summary = wardrobe_inventory_summary(wardrobe)
    weights = week_event_weights(get_week_events(user_id))
    gaps = detect_gaps(summary, weights)

    payload = gaps_to_llm_payload(summary, weights, gaps)
    llm_order = await rank_shop_gap_ids(payload)
    gaps = _reorder_gaps(gaps, llm_order)

    inferred = infer_preferred_brands(summary)
    out: list[WardrobeGapSuggestion] = []
    for g in gaps[:8]:
        q = build_shop_query(g, profile, inferred)
        products = search_products_cached(g.gap_id, q, 4)
        out.append(
            WardrobeGapSuggestion(
                gap_id=g.gap_id,
                title=g.title,
                reason=g.reason,
                target_category=g.target_category,
                target_formality=g.target_formality,
                suggested_name=g.suggested_name,
                products=products,
            )
        )
    return ShopSuggestionsResponse(user_id=user_id, gaps=out)


@router.post("/{user_id}/shop/events", response_model=ShopEventAck)
async def post_shop_event(user_id: str, body: ShopEventRequest) -> ShopEventAck:
    et = (body.event_type or "").strip().lower()
    if et not in _ALLOWED_EVENTS:
        raise HTTPException(status_code=400, detail="invalid event_type")
    insert_shop_engagement_event(user_id, body.gap_id, et, body.product_id)
    return ShopEventAck()


@router.post("/{user_id}/shop/mark-purchased", response_model=GarmentItem)
async def mark_shop_purchased(user_id: str, body: ShopMarkPurchasedRequest) -> GarmentItem:
    now = datetime.utcnow()
    formality = body.formality or GarmentFormality.CASUAL
    seasonality = body.seasonality or GarmentSeasonality.ALL_SEASON
    tags = build_garment_tags(body.category, formality, seasonality)
    sub = (body.suggested_name or body.title or "item").strip()[:200]
    garment = GarmentItem(
        id=str(uuid4()),
        user_id=user_id,
        primary_image_url=body.primary_image_url,
        category=body.category,
        sub_category=sub,
        color_primary=body.color,
        formality=formality,
        seasonality=seasonality,
        brand=(body.brand or "").strip() or None,
        tags=tags,
        created_at=now,
        updated_at=now,
    )
    insert_shop_engagement_event(
        user_id,
        body.gap_id,
        "add_to_wardrobe",
        body.product_id,
    )
    return insert_garment(garment)
