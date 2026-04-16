"""Integration tests for wardrobe endpoints."""

from __future__ import annotations

import pytest


@pytest.mark.usefixtures("_isolate_env")
class TestGetWardrobe:
    async def test_empty_wardrobe(self, client):
        resp = await client.get("/wardrobe/new-user")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_after_adding_item(self, client):
        add_resp = await client.post(
            "/wardrobe/test-user/items",
            json={
                "name": "Blue shirt",
                "category": "top",
                "color": "blue",
                "primary_image_url": "https://example.com/img.jpg",
            },
        )
        assert add_resp.status_code == 200

        resp = await client.get("/wardrobe/test-user")
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) >= 1
        assert items[0]["category"] == "top"


@pytest.mark.usefixtures("_isolate_env")
class TestAddWardrobe:
    async def test_valid_add(self, client):
        resp = await client.post(
            "/wardrobe/test-user/items",
            json={
                "name": "Red pants",
                "category": "bottom",
                "color": "red",
                "primary_image_url": "https://example.com/pants.jpg",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["category"] == "bottom"
        assert data["user_id"] == "test-user"

    async def test_invalid_category_rejected(self, client):
        resp = await client.post(
            "/wardrobe/test-user/items",
            json={
                "name": "Thing",
                "category": "spaceship",
                "primary_image_url": "https://example.com/img.jpg",
            },
        )
        assert resp.status_code == 422

    async def test_missing_name_rejected(self, client):
        resp = await client.post(
            "/wardrobe/test-user/items",
            json={
                "category": "top",
                "primary_image_url": "https://example.com/img.jpg",
            },
        )
        assert resp.status_code == 422


@pytest.mark.usefixtures("_isolate_env")
class TestSearchGarment:
    async def test_missing_serpapi_key(self, client):
        resp = await client.post(
            "/wardrobe/test-user/search-garment",
            json={"query": "black shirt"},
        )
        assert resp.status_code == 503

    async def test_empty_query(self, client, monkeypatch):
        monkeypatch.setenv("SERPAPI_KEY", "fake-key")
        resp = await client.post(
            "/wardrobe/test-user/search-garment",
            json={"query": ""},
        )
        assert resp.status_code == 400
