"""Security tests for analytics API key enforcement."""

from __future__ import annotations

import httpx
import pytest
from httpx import ASGITransport


@pytest.mark.usefixtures("_isolate_env", "_mock_vision", "_mock_upload")
class TestAnalyticsKeyAuth:
    async def _make_client(self, monkeypatch):
        """Create a fresh client after env changes (CORS middleware reads env at import)."""
        from backend.main import app

        transport = ASGITransport(app=app)
        return httpx.AsyncClient(transport=transport, base_url="http://test")

    async def test_no_key_configured_allows_access(self, monkeypatch):
        monkeypatch.delenv("ANALYTICS_INTERNAL_API_KEY", raising=False)
        monkeypatch.delenv("ANALYTICS_SKIP_KEY_AUTH", raising=False)
        c = await self._make_client(monkeypatch)
        async with c:
            resp = await c.get("/analytics/metrics")
            assert resp.status_code == 200

    async def test_key_configured_rejects_missing_header(self, monkeypatch):
        monkeypatch.setenv("ANALYTICS_INTERNAL_API_KEY", "secret-123")
        monkeypatch.delenv("ANALYTICS_SKIP_KEY_AUTH", raising=False)
        c = await self._make_client(monkeypatch)
        async with c:
            resp = await c.get("/analytics/metrics")
            assert resp.status_code == 401

    async def test_key_configured_rejects_wrong_key(self, monkeypatch):
        monkeypatch.setenv("ANALYTICS_INTERNAL_API_KEY", "secret-123")
        monkeypatch.delenv("ANALYTICS_SKIP_KEY_AUTH", raising=False)
        c = await self._make_client(monkeypatch)
        async with c:
            resp = await c.get(
                "/analytics/metrics",
                headers={"X-Analytics-Key": "wrong-key"},
            )
            assert resp.status_code == 401

    async def test_key_configured_accepts_correct_key(self, monkeypatch):
        monkeypatch.setenv("ANALYTICS_INTERNAL_API_KEY", "secret-123")
        monkeypatch.delenv("ANALYTICS_SKIP_KEY_AUTH", raising=False)
        c = await self._make_client(monkeypatch)
        async with c:
            resp = await c.get(
                "/analytics/metrics",
                headers={"X-Analytics-Key": "secret-123"},
            )
            assert resp.status_code == 200

    async def test_skip_auth_bypasses_key_check(self, monkeypatch):
        monkeypatch.setenv("ANALYTICS_INTERNAL_API_KEY", "secret-123")
        monkeypatch.setenv("ANALYTICS_SKIP_KEY_AUTH", "true")
        c = await self._make_client(monkeypatch)
        async with c:
            resp = await c.get("/analytics/metrics")
            assert resp.status_code == 200

    async def test_public_metrics_also_protected(self, monkeypatch):
        monkeypatch.setenv("ANALYTICS_INTERNAL_API_KEY", "secret-123")
        monkeypatch.delenv("ANALYTICS_SKIP_KEY_AUTH", raising=False)
        c = await self._make_client(monkeypatch)
        async with c:
            resp = await c.get("/api/metrics")
            assert resp.status_code == 401

    async def test_register_not_protected(self, monkeypatch):
        monkeypatch.setenv("ANALYTICS_INTERNAL_API_KEY", "secret-123")
        monkeypatch.delenv("ANALYTICS_SKIP_KEY_AUTH", raising=False)
        c = await self._make_client(monkeypatch)
        async with c:
            resp = await c.post(
                "/analytics/register",
                json={"user_id": "test-user"},
            )
            assert resp.status_code == 204
