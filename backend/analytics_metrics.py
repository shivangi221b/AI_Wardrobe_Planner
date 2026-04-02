"""
Aggregate product metrics for an internal dashboard.

- **signups**: Supabase Auth user count (all time), when the project URL and
  service role key are configured.
- **waitlist**: prefer a **published CSV URL** (Google Sheets export, etc.) fetched on
  each request; otherwise row count on an optional Supabase table (default
  ``waitlist``).
- **page_views** / **active_users**: Google Analytics 4, when ``GA4_PROPERTY_ID``
  and Application Default Credentials (or ``GOOGLE_APPLICATION_CREDENTIALS``)
  are configured.

Until GA4 or Supabase credentials are wired for production, numeric fields fall
back to ``0`` so callers always receive a stable JSON shape.

Set ``ANALYTICS_USE_DUMMY_METRICS=true`` to return fixed placeholder counts for
demos (see ``build_analytics_summary``).
"""

from __future__ import annotations

import csv
import io
import logging
import os
from datetime import datetime, timezone
from typing import Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

# Cap download size so a misconfigured URL cannot blow memory on each metrics call.
_MAX_WAITLIST_CSV_BYTES = 5 * 1024 * 1024


def _env_truthy(name: str) -> bool:
    return (os.getenv(name) or "").strip().lower() in ("1", "true", "yes", "on")


def _supabase_rest_config() -> tuple[Optional[str], Optional[str]]:
    url = (os.getenv("SUPABASE_URL") or "").strip().rstrip("/") or None
    key = (os.getenv("SUPABASE_SERVICE_KEY") or "").strip() or None
    return url, key


def count_supabase_auth_users() -> int:
    """Total users returned by Supabase Auth Admin API (paginated)."""
    base, service_key = _supabase_rest_config()
    if not base or not service_key:
        return 0

    headers = {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
    }
    total = 0
    page = 1
    per_page = 200
    try:
        with httpx.Client(timeout=30.0) as client:
            while True:
                resp = client.get(
                    f"{base}/auth/v1/admin/users",
                    headers=headers,
                    params={"page": page, "per_page": per_page},
                )
                if resp.status_code >= 400:
                    logger.warning(
                        "Supabase auth user list failed status=%s body=%s",
                        resp.status_code,
                        resp.text[:300],
                    )
                    return 0
                payload = resp.json()
                users = payload.get("users") if isinstance(payload, dict) else None
                if not isinstance(users, list):
                    return 0
                total += len(users)
                if len(users) < per_page:
                    break
                page += 1
        return total
    except Exception:
        logger.exception("Supabase auth user count failed")
        return 0


def _csv_row_is_nonempty(row: list[str]) -> bool:
    return any((cell or "").strip() for cell in row)


def count_waitlist_from_csv_url(url: str) -> int:
    """
    Fetch *url* (typically a Google Sheets ``export?format=csv`` link), parse as
    CSV, and return the number of data rows. Empty rows are skipped.

    No API key is required if the sheet is visible to ``Anyone with the link``.
    Called on every ``GET /analytics/metrics`` (no separate cache).
    """
    url = url.strip()
    try:
        with httpx.Client(timeout=20.0, follow_redirects=True) as client:
            resp = client.get(url)
            if resp.status_code >= 400:
                logger.warning(
                    "Waitlist CSV fetch failed status=%s url=%s",
                    resp.status_code,
                    url[:80],
                )
                return 0
            raw = resp.content
            if len(raw) > _MAX_WAITLIST_CSV_BYTES:
                logger.warning("Waitlist CSV response too large (%s bytes); using 0.", len(raw))
                return 0
        text = raw.decode("utf-8-sig")
        reader = csv.reader(io.StringIO(text))
        rows = [r for r in reader if _csv_row_is_nonempty(r)]
        if not rows:
            return 0
        skip_header = (os.getenv("WAITLIST_CSV_SKIP_HEADER") or "true").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        if skip_header:
            rows = rows[1:]
        return len(rows)
    except Exception:
        logger.exception("Waitlist CSV URL read failed url=%s", url[:80])
        return 0


def count_waitlist_rows() -> int:
    """
    Waitlist size: ``WAITLIST_SHEET_CSV_URL`` if set (live CSV fetch), else Supabase table.
    """
    csv_url = (os.getenv("WAITLIST_SHEET_CSV_URL") or "").strip()
    if csv_url:
        return count_waitlist_from_csv_url(csv_url)

    table = (os.getenv("SUPABASE_WAITLIST_TABLE") or "waitlist").strip() or "waitlist"
    base, service_key = _supabase_rest_config()
    if not base or not service_key:
        return 0

    try:
        from supabase import create_client

        client = create_client(base, service_key)
        result = client.table(table).select("id", count="exact").limit(1).execute()
        return int(result.count or 0)
    except Exception:
        logger.info(
            "Waitlist count unavailable (table %r missing or not readable); using 0.",
            table,
        )
        return 0


def fetch_ga4_screen_metrics(days: int) -> Tuple[Optional[int], Optional[int]]:
    """
    Return ``(page_views, active_users)`` for the last *days* days from GA4.

    Uses metrics ``screenPageViews`` and ``activeUsers``. Returns ``(None, None)``
    when GA4 is not configured or the request fails.
    """
    prop_raw = (os.getenv("GA4_PROPERTY_ID") or "").strip()
    if not prop_raw:
        return None, None

    prop_digits = prop_raw.replace("properties/", "")
    if not prop_digits.isdigit():
        logger.warning("GA4_PROPERTY_ID must be numeric (got %r).", prop_raw)
        return None, None

    days = max(1, min(int(days), 366))
    try:
        from google.analytics.data_v1beta import BetaAnalyticsDataClient
        from google.analytics.data_v1beta.types import DateRange, Metric, RunReportRequest
    except ImportError:
        logger.warning("google-analytics-data is not installed; GA4 metrics unavailable.")
        return None, None

    try:
        client = BetaAnalyticsDataClient()
        request = RunReportRequest(
            property=f"properties/{prop_digits}",
            date_ranges=[DateRange(start_date=f"{days}daysAgo", end_date="today")],
            metrics=[
                Metric(name="screenPageViews"),
                Metric(name="activeUsers"),
            ],
        )
        response = client.run_report(request)
        if not response.rows:
            return 0, 0
        row = response.rows[0]
        pv = int(row.metric_values[0].value)
        au = int(row.metric_values[1].value)
        return pv, au
    except Exception:
        logger.exception("GA4 Data API request failed")
        return None, None


def build_analytics_summary(*, period_days: int = 28) -> dict:
    now = datetime.now(timezone.utc)
    if _env_truthy("ANALYTICS_USE_DUMMY_METRICS"):
        return {
            "signups": 2,
            "active_users": 3,
            "waitlist": 5,
            "page_views": 5,
            "period_days": period_days,
            "as_of": now.isoformat(),
            "ga4_configured": False,
            "dummy_data": True,
        }

    signups = count_supabase_auth_users()
    waitlist = count_waitlist_rows()
    ga_pv, ga_au = fetch_ga4_screen_metrics(period_days)
    page_views = 0 if ga_pv is None else ga_pv
    active_users = 0 if ga_au is None else ga_au

    return {
        "signups": signups,
        "active_users": active_users,
        "waitlist": waitlist,
        "page_views": page_views,
        "period_days": period_days,
        "as_of": now.isoformat(),
        "ga4_configured": ga_pv is not None,
        "dummy_data": False,
    }
