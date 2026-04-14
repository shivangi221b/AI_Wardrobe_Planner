"""Integration tests for the calendar sync endpoint."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from backend.routers.calendar_router import _map_summary_to_event_type


class TestMapSummaryToEventType:
    def test_gym_keywords(self):
        assert _map_summary_to_event_type("Morning gym session") == "gym"
        assert _map_summary_to_event_type("yoga class") == "gym"

    def test_work_keywords(self):
        assert _map_summary_to_event_type("Team standup") == "work_meeting"
        assert _map_summary_to_event_type("Client presentation") == "work_meeting"

    def test_date_keywords(self):
        assert _map_summary_to_event_type("Romantic dinner") == "date_night"

    def test_unknown_defaults_to_casual(self):
        assert _map_summary_to_event_type("Pick up groceries") == "casual"


@pytest.mark.usefixtures("_isolate_env")
class TestCalendarSync:
    async def test_invalid_token_returns_401(self, client):
        today = datetime.now(timezone.utc).date()
        monday = today - timedelta(days=today.weekday())

        mock_response = httpx.Response(401, json={"error": "invalid_token"})

        with patch("backend.routers.calendar_router.httpx.AsyncClient") as MockClient:
            mock_instance = AsyncMock()
            mock_instance.get.return_value = mock_response
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_instance

            resp = await client.post(
                "/users/test-user/calendar/sync",
                json={"google_access_token": "bad-token"},
            )
            assert resp.status_code == 401

    async def test_successful_sync(self, client):
        today = datetime.now(timezone.utc).date()
        monday = today - timedelta(days=today.weekday())
        event_date = monday.isoformat()

        mock_response = httpx.Response(
            200,
            json={
                "items": [
                    {
                        "summary": "Team standup",
                        "start": {"date": event_date},
                    }
                ]
            },
        )

        with patch("backend.routers.calendar_router.httpx.AsyncClient") as MockClient:
            mock_instance = AsyncMock()
            mock_instance.get.return_value = mock_response
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_instance

            resp = await client.post(
                "/users/test-user/calendar/sync",
                json={"google_access_token": "valid-token"},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert len(data["events"]) == 7
            assert data["events"][0]["event_type"] == "work_meeting"
