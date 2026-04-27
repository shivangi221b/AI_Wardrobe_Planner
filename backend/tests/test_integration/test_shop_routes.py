"""Integration tests for shop suggestions and mark-purchased."""

from __future__ import annotations

import pytest

from backend.models import WeekEvent
from backend.storage import store_week_events


@pytest.fixture(autouse=True)
def _force_local_wardrobe_store(monkeypatch):
    """Avoid Supabase when the developer has credentials in ``.env`` loaded by ``main``."""
    monkeypatch.setattr("backend.db._use_local_store", lambda: True)


@pytest.mark.usefixtures("_isolate_env")
class TestShopSuggestions:
    async def test_suggestions_returns_gaps_with_products(self, client):
        store_week_events(
            "shop-user",
            [WeekEvent(day="monday", event_type="work_meeting")] * 3
            + [WeekEvent(day="tuesday", event_type="casual")],
        )
        resp = await client.get("/users/shop-user/shop/suggestions")
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_id"] == "shop-user"
        assert isinstance(data["gaps"], list)
        assert len(data["gaps"]) >= 1
        g0 = data["gaps"][0]
        assert "gap_id" in g0
        assert "products" in g0
        assert isinstance(g0["products"], list)

    async def test_shop_event_ok(self, client):
        resp = await client.post(
            "/users/shop-user/shop/events",
            json={"gap_id": "neutral_shoes", "event_type": "click", "product_id": "abc"},
        )
        assert resp.status_code == 200
        assert resp.json().get("ok") is True


@pytest.mark.usefixtures("_isolate_env")
class TestShopMarkPurchased:
    async def test_creates_wardrobe_row(self, client):
        resp = await client.post(
            "/users/shop-user-2/shop/mark-purchased",
            json={
                "gap_id": "neutral_shoes",
                "suggested_name": "White sneakers",
                "title": "Example Sneaker",
                "primary_image_url": "https://example.com/sneaker.jpg",
                "category": "shoes",
                "formality": "smart_casual",
                "brand": "Example Co",
            },
        )
        assert resp.status_code == 200
        row = resp.json()
        assert row["category"] == "shoes"
        assert row["brand"] == "Example Co"

        w = await client.get("/wardrobe/shop-user-2")
        assert w.status_code == 200
        items = w.json()
        assert len(items) == 1
        assert items[0]["sub_category"] == "White sneakers"
