"""Unit tests for backend.llm — SSRF checks and LLM explanation generation."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.llm import _is_safe_image_url, generate_outfit_explanation


class TestIsSafeImageUrl:
    """Validate the SSRF protection helper."""

    @pytest.mark.parametrize(
        "url",
        [
            "https://example.com/image.jpg",
            "https://cdn.supabase.co/storage/garments/1.jpg",
            "http://public-cdn.example.org/photo.png",
        ],
    )
    def test_allows_public_urls(self, url):
        assert _is_safe_image_url(url) is True

    @pytest.mark.parametrize(
        "url",
        [
            "http://127.0.0.1/secret",
            "http://169.254.169.254/latest/meta-data/",
            "http://10.0.0.1/internal",
            "http://172.16.0.1/private",
            "http://192.168.1.1/home",
            "http://metadata.google.internal/computeMetadata/v1/",
            "http://100.100.100.200/latest/meta-data",
            "http://0.0.0.0/",
        ],
    )
    def test_blocks_private_and_metadata_urls(self, url):
        assert _is_safe_image_url(url) is False

    @pytest.mark.parametrize(
        "url",
        [
            "file:///etc/passwd",
            "ftp://ftp.example.com/file",
            "gopher://evil.com/",
            "",
            "not-a-url",
        ],
    )
    def test_blocks_non_http_schemes(self, url):
        assert _is_safe_image_url(url) is False


class TestGenerateOutfitExplanation:
    async def test_fallback_when_no_gcp_project(self, monkeypatch):
        monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
        from backend import llm
        llm._gemini_client.cache_clear()

        result = await generate_outfit_explanation("Monday", "work_meeting", None, None)
        assert "Monday" in result
        assert "work meeting" in result

    async def test_fallback_on_api_error(self, monkeypatch):
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = RuntimeError("API down")
        monkeypatch.setattr("backend.llm._gemini_client", lambda: mock_client)

        result = await generate_outfit_explanation("Tuesday", "gym", None, None)
        assert "Tuesday" in result
        assert "gym" in result
