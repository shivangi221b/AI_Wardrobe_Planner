"""Performance tests for key API endpoints."""

from __future__ import annotations

import time

import pytest


@pytest.mark.usefixtures("_isolate_env", "_mock_llm")
class TestEndpointLatency:
    async def test_wardrobe_get_under_200ms(self, client):
        start = time.perf_counter()
        resp = await client.get("/wardrobe/perf-user")
        elapsed = time.perf_counter() - start

        assert resp.status_code == 200
        assert elapsed < 0.2, f"GET /wardrobe took {elapsed:.3f}s (limit: 200ms)"

    async def test_add_garment_under_200ms(self, client):
        start = time.perf_counter()
        resp = await client.post(
            "/wardrobe/perf-user/items",
            json={
                "name": "Perf test shirt",
                "category": "top",
                "primary_image_url": "https://example.com/perf.jpg",
            },
        )
        elapsed = time.perf_counter() - start

        assert resp.status_code == 200
        assert elapsed < 0.2, f"POST /wardrobe/.../items took {elapsed:.3f}s (limit: 200ms)"

    async def test_week_events_round_trip_under_200ms(self, client):
        start = time.perf_counter()
        await client.put(
            "/users/perf-user/week-events",
            json={"events": [{"day": "Monday", "event_type": "gym"}]},
        )
        resp = await client.get("/users/perf-user/week-events")
        elapsed = time.perf_counter() - start

        assert resp.status_code == 200
        assert elapsed < 0.2, f"Week events round-trip took {elapsed:.3f}s (limit: 200ms)"

    async def test_media_ingestion_under_200ms(self, client):
        start = time.perf_counter()
        resp = await client.post(
            "/media-ingestion",
            json={
                "user_id": "perf-user",
                "media_type": "image_batch",
                "source_uri": "gs://bucket/test",
            },
        )
        elapsed = time.perf_counter() - start

        assert resp.status_code == 200
        assert elapsed < 0.2, f"POST /media-ingestion took {elapsed:.3f}s (limit: 200ms)"

    async def test_analytics_metrics_under_500ms(self, client, monkeypatch):
        monkeypatch.setenv("ANALYTICS_USE_DUMMY_METRICS", "true")
        start = time.perf_counter()
        resp = await client.get("/analytics/metrics")
        elapsed = time.perf_counter() - start

        assert resp.status_code == 200
        assert elapsed < 0.5, f"GET /analytics/metrics took {elapsed:.3f}s (limit: 500ms)"
