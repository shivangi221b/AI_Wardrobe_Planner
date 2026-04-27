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

    async def test_respects_pin_constraints(self, client):
        top = await client.post(
            "/wardrobe/test-user/items",
            json={
                "name": "Pinned white shirt",
                "category": "top",
                "primary_image_url": "https://example.com/shirt.jpg",
                "formality": "business",
            },
        )
        bottom = await client.post(
            "/wardrobe/test-user/items",
            json={
                "name": "Pinned dark trousers",
                "category": "bottom",
                "primary_image_url": "https://example.com/pants.jpg",
                "formality": "business",
            },
        )
        assert top.status_code == 200
        assert bottom.status_code == 200
        top_id = top.json()["id"]
        bottom_id = bottom.json()["id"]

        resp = await client.post(
            "/recommendations/week",
            json={
                "user_id": "test-user",
                "events": [{"day": "Monday", "event_type": "work_meeting"}],
                "pin_constraints": [
                    {
                        "day": "Monday",
                        "pin_whole_outfit": True,
                        "top_id": top_id,
                        "bottom_id": bottom_id,
                    }
                ],
            },
        )
        assert resp.status_code == 200
        rec = resp.json()["recommendations"][0]
        assert rec["top_id"] == top_id
        assert rec["bottom_id"] == bottom_id
