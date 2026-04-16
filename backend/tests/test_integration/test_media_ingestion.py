"""Integration tests for media ingestion endpoints."""

from __future__ import annotations

import pytest


@pytest.mark.usefixtures("_isolate_env")
class TestMediaIngestion:
    async def test_create_job(self, client):
        resp = await client.post(
            "/media-ingestion",
            json={
                "user_id": "test-user",
                "media_type": "image_batch",
                "source_uri": "gs://bucket/photos.zip",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "job_id" in data
        assert data["status"] == "pending"

    async def test_get_job(self, client):
        create_resp = await client.post(
            "/media-ingestion",
            json={
                "user_id": "test-user",
                "media_type": "video",
                "source_uri": "gs://bucket/vid.mp4",
            },
        )
        job_id = create_resp.json()["job_id"]

        resp = await client.get(f"/media-ingestion/{job_id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == job_id

    async def test_unknown_job_404(self, client):
        resp = await client.get("/media-ingestion/nonexistent-id")
        assert resp.status_code == 404

    async def test_invalid_media_type_rejected(self, client):
        resp = await client.post(
            "/media-ingestion",
            json={
                "user_id": "test-user",
                "media_type": "hologram",
                "source_uri": "gs://bucket/x",
            },
        )
        assert resp.status_code == 422
