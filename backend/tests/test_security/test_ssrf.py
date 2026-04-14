"""Security tests for SSRF protections and trusted-URL checks."""

from __future__ import annotations

import pytest

from backend.llm import _is_safe_image_url
from backend.main import _is_trusted_image_url


class TestSsrfImageUrl:
    """Tests for the LLM image-fetch SSRF guard."""

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
            "http://[::1]/",
        ],
    )
    def test_rejects_private_ips(self, url):
        assert _is_safe_image_url(url) is False

    @pytest.mark.parametrize(
        "url",
        [
            "file:///etc/passwd",
            "ftp://ftp.example.com/file",
            "gopher://evil.com/",
            "data:text/html,<h1>hi</h1>",
        ],
    )
    def test_rejects_non_http_schemes(self, url):
        assert _is_safe_image_url(url) is False

    def test_allows_public_https(self):
        assert _is_safe_image_url("https://cdn.example.com/image.jpg") is True


class TestTrustedImageUrl:
    """Tests for the vision commit trusted-URL check."""

    def test_accepts_anything_when_no_bases_configured(self, monkeypatch):
        monkeypatch.delenv("LOCAL_ASSET_BASE_URL", raising=False)
        monkeypatch.delenv("SUPABASE_URL", raising=False)
        assert _is_trusted_image_url("https://random.com/img.jpg") is True

    def test_rejects_foreign_url_when_supabase_set(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://abc.supabase.co")
        monkeypatch.delenv("LOCAL_ASSET_BASE_URL", raising=False)
        assert _is_trusted_image_url("https://evil.com/steal.jpg") is False

    def test_accepts_supabase_url(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://abc.supabase.co")
        monkeypatch.delenv("LOCAL_ASSET_BASE_URL", raising=False)
        assert _is_trusted_image_url("https://abc.supabase.co/storage/v1/garments/1.jpg") is True

    def test_accepts_local_asset_url(self, monkeypatch):
        monkeypatch.setenv("LOCAL_ASSET_BASE_URL", "http://127.0.0.1:8000")
        monkeypatch.delenv("SUPABASE_URL", raising=False)
        assert _is_trusted_image_url("http://127.0.0.1:8000/assets/local-garments/u/g.jpg") is True

    def test_rejects_empty_url(self, monkeypatch):
        monkeypatch.delenv("LOCAL_ASSET_BASE_URL", raising=False)
        monkeypatch.delenv("SUPABASE_URL", raising=False)
        assert _is_trusted_image_url("") is False
        assert _is_trusted_image_url("   ") is False
