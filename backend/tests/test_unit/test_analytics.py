"""Unit tests for backend.analytics_metrics."""

from __future__ import annotations

import pytest

from backend.analytics_metrics import (
    _csv_row_is_nonempty,
    _env_truthy,
    build_analytics_summary,
    count_signups,
)


class TestEnvTruthy:
    @pytest.mark.parametrize("value", ["1", "true", "True", "yes", "on"])
    def test_truthy_values(self, value, monkeypatch):
        monkeypatch.setenv("TEST_FLAG", value)
        assert _env_truthy("TEST_FLAG") is True

    @pytest.mark.parametrize("value", ["0", "false", "", "no", "off"])
    def test_falsy_values(self, value, monkeypatch):
        monkeypatch.setenv("TEST_FLAG", value)
        assert _env_truthy("TEST_FLAG") is False

    def test_missing_var(self, monkeypatch):
        monkeypatch.delenv("TEST_FLAG", raising=False)
        assert _env_truthy("TEST_FLAG") is False


class TestCsvRowIsNonempty:
    def test_empty_row(self):
        assert _csv_row_is_nonempty([]) is False

    def test_all_blank(self):
        assert _csv_row_is_nonempty(["", " ", ""]) is False

    def test_has_content(self):
        assert _csv_row_is_nonempty(["", "hello", ""]) is True


class TestBuildAnalyticsSummary:
    def test_dummy_metrics_mode(self, monkeypatch):
        monkeypatch.setenv("ANALYTICS_USE_DUMMY_METRICS", "true")
        summary = build_analytics_summary(period_days=7)
        assert summary["dummy_data"] is True
        assert summary["signups"] == 2
        assert summary["period_days"] == 7

    def test_real_mode_returns_all_keys(self, monkeypatch):
        monkeypatch.delenv("ANALYTICS_USE_DUMMY_METRICS", raising=False)
        monkeypatch.delenv("SUPABASE_URL", raising=False)
        monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)
        monkeypatch.delenv("GA4_PROPERTY_ID", raising=False)
        monkeypatch.delenv("FORMSPREE_FORM_ID", raising=False)
        monkeypatch.delenv("WAITLIST_SHEET_CSV_URL", raising=False)

        summary = build_analytics_summary()
        required_keys = {"signups", "active_users", "waitlist", "page_views", "period_days", "as_of", "ga4_configured", "dummy_data"}
        assert required_keys.issubset(summary.keys())
        assert summary["dummy_data"] is False
        assert summary["ga4_configured"] is False

    def test_period_days_clamped(self, monkeypatch):
        monkeypatch.setenv("ANALYTICS_USE_DUMMY_METRICS", "true")
        summary = build_analytics_summary(period_days=9999)
        assert summary["period_days"] == 366


class TestCountSignups:
    def test_returns_zero_without_config(self, monkeypatch):
        monkeypatch.delenv("SUPABASE_URL", raising=False)
        monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)
        result = count_signups()
        assert isinstance(result, int)
        assert result >= 0
