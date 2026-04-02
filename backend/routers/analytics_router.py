from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from ..analytics_metrics import build_analytics_summary

router = APIRouter(prefix="/analytics", tags=["analytics"])

# Public shape for class / dashboards: GET /api/metrics → only the four int fields.
public_metrics_router = APIRouter(prefix="/api", tags=["metrics"])


class PublicMetricsResponse(BaseModel):
    """Minimal JSON matching Startup Studio slide: four integer fields only."""

    signups: int
    active_users: int
    waitlist: int
    page_views: int


class AnalyticsSummaryResponse(BaseModel):
    signups: int = Field(description="Supabase Auth users (all time), when configured.")
    active_users: int = Field(
        description="GA4 activeUsers over the rolling ``period_days`` window."
    )
    waitlist: int = Field(
        description="Waitlist signups: CSV URL row count (WAITLIST_SHEET_CSV_URL) or Supabase table rows."
    )
    page_views: int = Field(
        description="GA4 screenPageViews over the rolling ``period_days`` window."
    )
    period_days: int = Field(
        default=28,
        ge=1,
        le=366,
        description="Rolling window (days) used for GA4 ``page_views`` and ``active_users``.",
    )
    as_of: str
    ga4_configured: bool = Field(
        default=False,
        description="True when GA4 returned data for this request; if false, GA fields are 0.",
    )
    dummy_data: bool = Field(
        default=False,
        description="True when ``ANALYTICS_USE_DUMMY_METRICS`` is enabled (placeholder counts).",
    )


def require_analytics_access(
    x_analytics_key: Optional[str] = Header(None, alias="X-Analytics-Key"),
) -> None:
    """
    If ``ANALYTICS_INTERNAL_API_KEY`` is set in the environment, require the same
    value in the ``X-Analytics-Key`` header. When unset, the route stays open
    for local development (lock this down before going live).

    Set ``ANALYTICS_SKIP_KEY_AUTH=true`` temporarily (e.g. while tunneling local
    dev) to skip the header check even when a key is configured.
    """
    if (os.getenv("ANALYTICS_SKIP_KEY_AUTH") or "").strip().lower() in ("1", "true", "yes", "on"):
        return
    expected = (os.getenv("ANALYTICS_INTERNAL_API_KEY") or "").strip()
    if not expected:
        return
    if not x_analytics_key or x_analytics_key.strip() != expected:
        raise HTTPException(status_code=401, detail="Missing or invalid X-Analytics-Key")


@router.get(
    "/metrics",
    response_model=AnalyticsSummaryResponse,
    dependencies=[Depends(require_analytics_access)],
)
def get_metrics(period_days: int = 28) -> AnalyticsSummaryResponse:
    """
    Internal metrics snapshot for dashboards: signups, waitlist size, and (when
    GA4 is configured) rolling page views and active users.

    Set ``ANALYTICS_INTERNAL_API_KEY`` in production and pass it as
    ``X-Analytics-Key``.
    """
    payload = build_analytics_summary(period_days=period_days)
    return AnalyticsSummaryResponse.model_validate(payload)


@public_metrics_router.get(
    "/metrics",
    response_model=PublicMetricsResponse,
    dependencies=[Depends(require_analytics_access)],
)
def get_public_metrics(period_days: int = 28) -> PublicMetricsResponse:
    """
    Same data as ``GET /analytics/metrics`` but only the four counters (slide format).
    """
    p = build_analytics_summary(period_days=period_days)
    return PublicMetricsResponse(
        signups=p["signups"],
        active_users=p["active_users"],
        waitlist=p["waitlist"],
        page_views=p["page_views"],
    )
