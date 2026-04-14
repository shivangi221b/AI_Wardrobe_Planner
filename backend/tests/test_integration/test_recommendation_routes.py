"""Integration tests for the recommendations endpoint."""

from __future__ import annotations

import pytest


@pytest.mark.usefixtures("_isolate_env", "_mock_llm")
class TestRecommendWeek:
    async def test_successful_recommendation(self, client):
        await client.post(
            "/wardrobe/test-user/items",
            json={
                "name": "White shirt",
                "category": "top",
                "primary_image_url": "https://example.com/shirt.jpg",
                "formality": "formal",
            },
        )
        await client.post(
            "/wardrobe/test-user/items",
            json={
                "name": "Dark pants",
                "category": "bottom",
                "primary_image_url": "https://example.com/pants.jpg",
                "formality": "formal",
            },
        )

        resp = await client.post(
            "/recommendations/week",
            json={
                "user_id": "test-user",
                "events": [
                    {"day": "Monday", "event_type": "work_meeting"},
                    {"day": "Tuesday", "event_type": "casual"},
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_id"] == "test-user"
        assert len(data["recommendations"]) == 2

    async def test_empty_wardrobe_still_returns(self, client):
        resp = await client.post(
            "/recommendations/week",
            json={
                "user_id": "empty-user",
                "events": [{"day": "Monday", "event_type": "gym"}],
            },
        )
        assert resp.status_code == 200
        recs = resp.json()["recommendations"]
        assert len(recs) == 1
        assert recs[0]["top_name"] == "No item found"

    async def test_empty_events_list(self, client):
        resp = await client.post(
            "/recommendations/week",
            json={"user_id": "test-user", "events": []},
        )
        assert resp.status_code == 200
        assert resp.json()["recommendations"] == []

    async def test_persists_week_events(self, client):
        events = [{"day": "Wednesday", "event_type": "date_night"}]
        await client.post(
            "/recommendations/week",
            json={"user_id": "persist-user", "events": events},
        )
        resp = await client.get("/users/persist-user/week-events")
        assert resp.status_code == 200
        stored = resp.json()["events"]
        assert len(stored) == 1
        assert stored[0]["day"] == "Wednesday"
