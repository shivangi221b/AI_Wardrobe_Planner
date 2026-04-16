"""Integration tests for vision endpoints."""

from __future__ import annotations

import pytest


@pytest.mark.usefixtures("_isolate_env", "_mock_vision", "_mock_upload")
class TestExtractPreview:
    async def test_successful_preview(self, client):
        resp = await client.post(
            "/vision/extract-preview",
            data={"user_id": "test-user"},
            files={"file": ("photo.jpg", b"\xff\xd8test-image-bytes", "image/jpeg")},
        )
        assert resp.status_code == 200
        previews = resp.json()
        assert isinstance(previews, list)
        assert len(previews) >= 1
        assert "image_url" in previews[0]

    async def test_empty_file_rejected(self, client):
        resp = await client.post(
            "/vision/extract-preview",
            data={"user_id": "test-user"},
            files={"file": ("photo.jpg", b"", "image/jpeg")},
        )
        assert resp.status_code == 400


@pytest.mark.usefixtures("_isolate_env")
class TestVisionCommit:
    async def test_untrusted_url_rejected(self, client, monkeypatch):
        monkeypatch.setenv("LOCAL_ASSET_BASE_URL", "https://trusted.example.com")
        monkeypatch.setenv("SUPABASE_URL", "https://supabase.example.com")
        resp = await client.post(
            "/vision/commit?user_id=test-user",
            json={
                "items": [
                    {
                        "image_url": "https://evil.com/steal.jpg",
                        "category": "top",
                    }
                ]
            },
        )
        assert resp.status_code == 400

    async def test_trusted_url_accepted(self, client, monkeypatch):
        monkeypatch.delenv("LOCAL_ASSET_BASE_URL", raising=False)
        monkeypatch.delenv("SUPABASE_URL", raising=False)
        resp = await client.post(
            "/vision/commit?user_id=test-user",
            json={
                "items": [
                    {
                        "image_url": "https://any-url.com/img.jpg",
                        "category": "top",
                    }
                ]
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)


@pytest.mark.usefixtures("_isolate_env", "_mock_vision", "_mock_upload")
class TestVisionExtract:
    async def test_successful_extract(self, client):
        resp = await client.post(
            "/vision/extract",
            data={"user_id": "test-user"},
            files={"file": ("photo.jpg", b"\xff\xd8test-data", "image/jpeg")},
        )
        assert resp.status_code == 200
        garments = resp.json()
        assert isinstance(garments, list)
        assert len(garments) >= 1
        assert "id" in garments[0]

    async def test_empty_file_rejected(self, client):
        resp = await client.post(
            "/vision/extract",
            data={"user_id": "test-user"},
            files={"file": ("photo.jpg", b"", "image/jpeg")},
        )
        assert resp.status_code == 400
