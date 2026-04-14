"""Security tests for input validation on API endpoints."""

from __future__ import annotations

import pytest


@pytest.mark.usefixtures("_isolate_env")
class TestInputValidation:
    async def test_sql_injection_in_user_id(self, client):
        """user_id with SQL-like payload should not crash the server."""
        resp = await client.get("/wardrobe/'; DROP TABLE garments; --")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_path_traversal_in_user_id(self, client):
        """Path traversal attempt in user_id should not expose files."""
        resp = await client.get("/wardrobe/../../etc/passwd")
        # FastAPI will either 404 or return empty wardrobe — not a server error
        assert resp.status_code in (200, 404, 422)

    async def test_missing_request_body(self, client):
        resp = await client.post("/wardrobe/test-user/items")
        assert resp.status_code == 422

    async def test_wrong_content_type(self, client):
        resp = await client.post(
            "/wardrobe/test-user/items",
            content="not json",
            headers={"Content-Type": "text/plain"},
        )
        assert resp.status_code == 422

    async def test_extra_fields_ignored(self, client):
        resp = await client.post(
            "/wardrobe/test-user/items",
            json={
                "name": "Shirt",
                "category": "top",
                "primary_image_url": "https://example.com/img.jpg",
                "malicious_field": "drop database",
            },
        )
        assert resp.status_code == 200

    async def test_very_long_user_id(self, client):
        long_id = "a" * 5000
        resp = await client.get(f"/wardrobe/{long_id}")
        assert resp.status_code in (200, 414, 422)

    async def test_unicode_in_garment_name(self, client):
        resp = await client.post(
            "/wardrobe/test-user/items",
            json={
                "name": "ünïcödé 衬衫 👕",
                "category": "top",
                "primary_image_url": "https://example.com/img.jpg",
            },
        )
        assert resp.status_code == 200

    async def test_week_events_invalid_body(self, client):
        resp = await client.put(
            "/users/test-user/week-events",
            json={"events": "not-a-list"},
        )
        assert resp.status_code == 422

    async def test_recommendations_invalid_events(self, client):
        resp = await client.post(
            "/recommendations/week",
            json={"user_id": "u1", "events": [{"bad": "shape"}]},
        )
        assert resp.status_code == 422
