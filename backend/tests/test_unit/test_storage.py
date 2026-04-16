"""Unit tests for the in-memory week-events store (backend.storage)."""

from __future__ import annotations

import pytest

from backend.models import WeekEvent
from backend.storage import get_week_events, store_week_events, _week_events


@pytest.fixture(autouse=True)
def _clear_store():
    """Ensure a clean in-memory store for every test."""
    _week_events.clear()
    yield
    _week_events.clear()


class TestStoreWeekEvents:
    def test_round_trip(self):
        events = [WeekEvent(day="Monday", event_type="work_meeting")]
        store_week_events("user-1", events)
        result = get_week_events("user-1")
        assert len(result) == 1
        assert result[0].day == "Monday"

    def test_overwrite(self):
        store_week_events("user-1", [WeekEvent(day="Monday", event_type="gym")])
        store_week_events("user-1", [WeekEvent(day="Tuesday", event_type="casual")])
        result = get_week_events("user-1")
        assert len(result) == 1
        assert result[0].day == "Tuesday"

    def test_unknown_user_returns_empty(self):
        assert get_week_events("nonexistent") == []

    def test_multiple_users_isolated(self):
        store_week_events("a", [WeekEvent(day="Monday", event_type="gym")])
        store_week_events("b", [WeekEvent(day="Friday", event_type="date_night")])
        assert get_week_events("a")[0].day == "Monday"
        assert get_week_events("b")[0].day == "Friday"

    def test_empty_events_list(self):
        store_week_events("user-1", [])
        assert get_week_events("user-1") == []

    def test_stored_list_is_copy(self):
        events = [WeekEvent(day="Monday", event_type="gym")]
        store_week_events("user-1", events)
        events.append(WeekEvent(day="Tuesday", event_type="casual"))
        assert len(get_week_events("user-1")) == 1

    def test_returned_list_is_copy(self):
        store_week_events("user-1", [WeekEvent(day="Monday", event_type="gym")])
        result = get_week_events("user-1")
        result.clear()
        assert len(get_week_events("user-1")) == 1
