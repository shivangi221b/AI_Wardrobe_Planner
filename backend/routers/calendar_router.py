"""
routers/calendar_router.py — Google Calendar sync endpoint.

Accepts the user's Google OAuth access token (obtained during sign-in with the
calendar.readonly scope), fetches events for the current ISO week from the
Google Calendar API, maps each event's summary to the app's EventType vocabulary
via keyword matching, and persists the result as the user's week plan.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import List

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..models import WeekEvent
from ..storage import store_week_events

router = APIRouter(tags=["calendar"])

GOOGLE_CALENDAR_EVENTS_URL = (
    "https://www.googleapis.com/calendar/v3/calendars/primary/events"
)

# Ordered list of (keywords, event_type) pairs — first match wins.
# Keywords are kept specific to reduce false positives (e.g. "call" and "office"
# were removed from work_meeting because they match "Call Mom" or "Office Depot").
_EVENT_TYPE_RULES: list[tuple[list[str], str]] = [
    (["gym", "workout", "fitness", "run", "running", "yoga", "crossfit", "pilates", "swim", "cycling", "hiit", "training"], "gym"),
    (["meeting", "standup", "stand-up", "interview", "client", "presentation", "conference", "1:1", "sprint", "review", "scrum", "retro", "all-hands"], "work_meeting"),
    (["date night", "romantic", "anniversary", "valentine"], "date_night"),
]


def _map_summary_to_event_type(summary: str) -> str:
    """Map a Google Calendar event summary string to an app EventType."""
    lower = summary.lower()
    for keywords, event_type in _EVENT_TYPE_RULES:
        if any(kw in lower for kw in keywords):
            return event_type
    return "casual"


def _iso_week_bounds() -> tuple[str, str]:
    """Return RFC3339 strings for Monday 00:00 and Sunday 23:59:59 of the current UTC week."""
    today = datetime.now(timezone.utc).date()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    time_min = datetime(monday.year, monday.month, monday.day, 0, 0, 0, tzinfo=timezone.utc).isoformat()
    time_max = datetime(sunday.year, sunday.month, sunday.day, 23, 59, 59, tzinfo=timezone.utc).isoformat()
    return time_min, time_max


_DAY_NAMES: list[str] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


class CalendarSyncRequest(BaseModel):
    google_access_token: str


class WeekEventsBody(BaseModel):
    events: List[WeekEvent]


@router.post("/users/{user_id}/calendar/sync", response_model=WeekEventsBody)
async def sync_calendar(user_id: str, body: CalendarSyncRequest) -> WeekEventsBody:
    """
    Fetch the current week's primary Google Calendar events using the supplied
    access token, map them to EventType, persist them, and return the result.
    """
    time_min, time_max = _iso_week_bounds()

    async with httpx.AsyncClient() as client:
        response = await client.get(
            GOOGLE_CALENDAR_EVENTS_URL,
            headers={"Authorization": f"Bearer {body.google_access_token}"},
            params={
                "timeMin": time_min,
                "timeMax": time_max,
                "singleEvents": "true",
                "orderBy": "startTime",
                "maxResults": "250",
            },
            timeout=10.0,
        )

    if response.status_code == 401:
        raise HTTPException(status_code=401, detail="Google access token is invalid or expired.")
    if not response.is_success:
        raise HTTPException(
            status_code=502,
            detail=f"Google Calendar API returned {response.status_code}.",
        )

    data = response.json()
    google_items: list[dict] = data.get("items", [])

    # Build a mapping of weekday index → (event_type, original_summary).
    # Multiple events on the same day: highest-priority type wins.
    _TYPE_PRIORITY = {"work_meeting": 3, "date_night": 2, "gym": 1, "casual": 0}
    day_events: dict[int, tuple[str, str]] = {}

    today = datetime.now(timezone.utc).date()
    monday = today - timedelta(days=today.weekday())

    for item in google_items:
        start = item.get("start", {})
        start_str: str | None = start.get("date") or start.get("dateTime")
        if not start_str:
            continue

        try:
            event_date = date.fromisoformat(start_str[:10])
        except ValueError:
            continue

        weekday_index = (event_date - monday).days
        if weekday_index < 0 or weekday_index > 6:
            continue

        summary: str = item.get("summary", "")
        mapped_type = _map_summary_to_event_type(summary)
        new_priority = _TYPE_PRIORITY.get(mapped_type, 0)

        if weekday_index in day_events:
            existing_type, _ = day_events[weekday_index]
            existing_priority = _TYPE_PRIORITY.get(existing_type, 0)
            if new_priority <= existing_priority:
                continue

        day_events[weekday_index] = (mapped_type, summary)

    events: list[WeekEvent] = [
        WeekEvent(
            day=_DAY_NAMES[i],
            event_type=day_events[i][0] if i in day_events else "none",
            original_summary=day_events[i][1] if i in day_events else None,
        )
        for i in range(7)
    ]

    store_week_events(user_id, events)
    return WeekEventsBody(events=events)
