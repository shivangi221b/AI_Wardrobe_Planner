"""Integration tests for analytics endpoints."""

from __future__ import annotations

import pytest


@pytest.mark.usefixtures("_isolate_env")
class TestRegisterSignup:
    async def test_returns_204(self, client):
        resp = await client.post(
            "/analytics/register",
            json={"user_id": "test-user-1"},
        )
        assert resp.status_code == 204

    async def test_idempotent(self, client):
        resp1 = await client.post("/analytics/register", json={"user_id": "u1"})
        resp2 = await client.post("/analytics/register", json={"user_id": "u1"})
        assert resp1.status_code == 204
        assert resp2.status_code == 204

    async def test_missing_user_id_rejected(self, client):
        resp = await client.post("/analytics/register", json={})
        assert resp.status_code == 422


@pytest.mark.usefixtures("_isolate_env")
class TestGetMetrics:
    async def test_no_auth_required_by_default(self, client):
        resp = await client.get("/analytics/metrics")
        assert resp.status_code == 200
        data = resp.json()
        assert "signups" in data
        assert "active_users" in data
        assert "waitlist" in data
        assert "page_views" in data

    async def test_dummy_metrics(self, client, monkeypatch):
        monkeypatch.setenv("ANALYTICS_USE_DUMMY_METRICS", "true")
        resp = await client.get("/analytics/metrics")
        assert resp.status_code == 200
        data = resp.json()
        assert data["dummy_data"] is True
        assert data["signups"] == 2

    async def test_period_days_param(self, client, monkeypatch):
        monkeypatch.setenv("ANALYTICS_USE_DUMMY_METRICS", "true")
        resp = await client.get("/analytics/metrics", params={"period_days": 7})
        assert resp.status_code == 200
        assert resp.json()["period_days"] == 7


@pytest.mark.usefixtures("_isolate_env")
class TestPublicMetrics:
    async def test_public_shape(self, client, monkeypatch):
        monkeypatch.setenv("ANALYTICS_USE_DUMMY_METRICS", "true")
        resp = await client.get("/api/metrics")
        assert resp.status_code == 200
        data = resp.json()
        assert set(data.keys()) == {"signups", "active_users", "waitlist", "page_views"}
