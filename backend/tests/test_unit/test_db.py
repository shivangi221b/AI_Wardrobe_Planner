"""Unit tests for backend.db — local store logic and parsing helpers."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from backend.db import (
    _local_wardrobes,
    _local_signup_user_ids,
    _local_user_profiles,
    _parse_category,
    _parse_datetime,
    _parse_formality,
    _parse_rpc_scalar_int,
    _parse_seasonality,
    _row_to_garment,
    _row_to_user_profile,
    _use_local_store,
    count_registered_signups,
    get_user_profile,
    get_wardrobe,
    insert_garment,
    register_signup_user_id,
    upsert_user_profile,
)
from backend.models import (
    AvatarConfig,
    GarmentCategory,
    GarmentFormality,
    GarmentItem,
    GarmentSeasonality,
    build_garment_tags,
)

_NOW = datetime(2026, 4, 14, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _clear_local_stores():
    _local_wardrobes.clear()
    _local_signup_user_ids.clear()
    _local_user_profiles.clear()
    yield
    _local_wardrobes.clear()
    _local_signup_user_ids.clear()
    _local_user_profiles.clear()


class TestUseLocalStore:
    def test_no_supabase_env_returns_true(self, monkeypatch):
        monkeypatch.delenv("SUPABASE_URL", raising=False)
        monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)
        assert _use_local_store() is True

    def test_with_supabase_env_default_returns_false(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_KEY", "secret")
        monkeypatch.delenv("IMAGE_STORAGE_BACKEND", raising=False)
        assert _use_local_store() is False

    def test_local_backend_override(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_KEY", "secret")
        monkeypatch.setenv("IMAGE_STORAGE_BACKEND", "local")
        assert _use_local_store() is True


class TestParseCategory:
    def test_valid_value(self):
        assert _parse_category("bottom") == GarmentCategory.BOTTOM

    def test_invalid_falls_back(self):
        assert _parse_category("unknown") == GarmentCategory.TOP

    def test_none_falls_back(self):
        assert _parse_category(None) == GarmentCategory.TOP


class TestParseFormality:
    def test_valid(self):
        assert _parse_formality("formal") == GarmentFormality.FORMAL

    def test_none(self):
        assert _parse_formality(None) is None

    def test_empty_string(self):
        assert _parse_formality("") is None

    def test_invalid(self):
        assert _parse_formality("ultra_formal") is None


class TestParseSeasonality:
    def test_valid(self):
        assert _parse_seasonality("cold") == GarmentSeasonality.COLD

    def test_none(self):
        assert _parse_seasonality(None) is None

    def test_invalid(self):
        assert _parse_seasonality("tropical") is None


class TestParseDatetime:
    def test_iso_string(self):
        dt = _parse_datetime("2026-04-14T12:00:00+00:00")
        assert dt.year == 2026
        assert dt.month == 4

    def test_z_suffix(self):
        dt = _parse_datetime("2026-04-14T12:00:00Z")
        assert dt.year == 2026

    def test_datetime_passthrough(self):
        now = datetime.now(timezone.utc)
        assert _parse_datetime(now) is now

    def test_none_returns_utcnow(self):
        dt = _parse_datetime(None)
        assert isinstance(dt, datetime)


class TestParseRpcScalarInt:
    def test_int(self):
        assert _parse_rpc_scalar_int(42) == 42

    def test_float(self):
        assert _parse_rpc_scalar_int(3.0) == 3

    def test_string_digit(self):
        assert _parse_rpc_scalar_int("10") == 10

    def test_list_single(self):
        assert _parse_rpc_scalar_int([5]) == 5

    def test_dict_single(self):
        assert _parse_rpc_scalar_int({"count": 7}) == 7

    def test_none(self):
        assert _parse_rpc_scalar_int(None) is None

    def test_bool(self):
        assert _parse_rpc_scalar_int(True) is None


class TestRowToGarment:
    def test_minimal_row(self):
        row = {
            "id": "g1",
            "user_id": "u1",
            "primary_image_url": "https://example.com/img.jpg",
            "category": "top",
            "created_at": "2026-04-14T12:00:00Z",
            "updated_at": "2026-04-14T12:00:00Z",
        }
        g = _row_to_garment(row)
        assert g.id == "g1"
        assert g.category == GarmentCategory.TOP
        assert len(g.tags) > 0

    def test_preserves_existing_tags(self):
        row = {
            "id": "g1",
            "user_id": "u1",
            "primary_image_url": "https://example.com/img.jpg",
            "category": "top",
            "tags": ["custom-tag"],
            "created_at": "2026-04-14T12:00:00Z",
            "updated_at": "2026-04-14T12:00:00Z",
        }
        g = _row_to_garment(row)
        assert g.tags == ["custom-tag"]


class TestLocalStoreInsertGet:
    @pytest.fixture(autouse=True)
    def _ensure_local(self, monkeypatch):
        monkeypatch.delenv("SUPABASE_URL", raising=False)
        monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)

    def test_insert_and_get(self):
        g = GarmentItem(
            id="g1",
            user_id="u1",
            primary_image_url="https://example.com/img.jpg",
            category=GarmentCategory.TOP,
            created_at=_NOW,
            updated_at=_NOW,
        )
        insert_garment(g)
        result = get_wardrobe("u1")
        assert len(result) == 1
        assert result[0].id == "g1"

    def test_empty_wardrobe(self):
        assert get_wardrobe("nobody") == []

    def test_insert_populates_tags(self):
        g = GarmentItem(
            id="g1",
            user_id="u1",
            primary_image_url="https://example.com/img.jpg",
            category=GarmentCategory.BOTTOM,
            formality=GarmentFormality.CASUAL,
            created_at=_NOW,
            updated_at=_NOW,
        )
        result = insert_garment(g)
        assert "bottom" in result.tags
        assert "casual" in result.tags


class TestSignupRegistry:
    @pytest.fixture(autouse=True)
    def _ensure_local(self, monkeypatch):
        monkeypatch.delenv("SUPABASE_URL", raising=False)
        monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)

    def test_register_and_count(self):
        register_signup_user_id("user-a")
        register_signup_user_id("user-b")
        assert count_registered_signups() == 2

    def test_idempotent(self):
        register_signup_user_id("user-a")
        register_signup_user_id("user-a")
        assert count_registered_signups() == 1

    def test_empty_or_whitespace_ignored(self):
        register_signup_user_id("")
        register_signup_user_id("   ")
        assert count_registered_signups() == 0

    def test_overlong_ignored(self):
        register_signup_user_id("x" * 600)
        assert count_registered_signups() == 0


# ---------------------------------------------------------------------------
# User profile helpers
# ---------------------------------------------------------------------------


class TestRowToUserProfile:
    def test_minimal_row(self):
        row = {"user_id": "u1", "updated_at": "2026-04-14T12:00:00Z"}
        p = _row_to_user_profile(row)
        assert p.user_id == "u1"
        assert p.avatar_config is None
        assert p.favorite_colors == []
        assert p.avoided_colors == []

    def test_avatar_config_dict_parsed(self):
        row = {
            "user_id": "u1",
            "avatar_config": {
                "hair_style": "long_straight",
                "hair_color": "black",
                "body_type": "slim",
                "skin_tone": "medium",
            },
        }
        p = _row_to_user_profile(row)
        assert p.avatar_config is not None
        assert p.avatar_config.hair_style == "long_straight"
        assert p.avatar_config.skin_tone == "medium"

    def test_avatar_config_none_stays_none(self):
        row = {"user_id": "u1", "avatar_config": None}
        p = _row_to_user_profile(row)
        assert p.avatar_config is None

    def test_avatar_config_string_ignored(self):
        # Non-dict values (e.g., corrupt data) should not crash.
        row = {"user_id": "u1", "avatar_config": "invalid"}
        p = _row_to_user_profile(row)
        assert p.avatar_config is None

    def test_color_lists_parsed(self):
        row = {
            "user_id": "u1",
            "favorite_colors": ["navy", "white"],
            "avoided_colors": ["red"],
        }
        p = _row_to_user_profile(row)
        assert p.favorite_colors == ["navy", "white"]
        assert p.avoided_colors == ["red"]


class TestLocalStoreUserProfile:
    @pytest.fixture(autouse=True)
    def _ensure_local(self, monkeypatch):
        monkeypatch.delenv("SUPABASE_URL", raising=False)
        monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)

    def test_get_returns_none_when_missing(self):
        assert get_user_profile("nobody") is None

    def test_upsert_creates_new_profile(self):
        p = upsert_user_profile("u1", {"gender": "female", "skin_tone": "light"})
        assert p.user_id == "u1"
        assert p.gender == "female"
        assert p.skin_tone == "light"

    def test_upsert_partial_does_not_clobber(self):
        upsert_user_profile("u1", {"gender": "female", "shoe_size": "38"})
        upsert_user_profile("u1", {"shoe_size": "39"})
        p = get_user_profile("u1")
        assert p is not None
        assert p.gender == "female"
        assert p.shoe_size == "39"

    def test_explicit_none_clears_field(self):
        upsert_user_profile("u1", {"skin_tone": "medium"})
        upsert_user_profile("u1", {"skin_tone": None})
        p = get_user_profile("u1")
        assert p is not None
        assert p.skin_tone is None

    def test_avatar_config_model_serialised_and_round_tripped(self):
        cfg = AvatarConfig(
            hair_style="curly_afro",
            hair_color="auburn",
            body_type="average",
            skin_tone="dark",
        )
        upsert_user_profile("u1", {"avatar_config": cfg})
        p = get_user_profile("u1")
        assert p is not None
        assert p.avatar_config is not None
        assert p.avatar_config.hair_style == "curly_afro"
        assert p.avatar_config.skin_tone == "dark"

    def test_avatar_config_none_clears(self):
        cfg = AvatarConfig(hair_style="short_wavy")
        upsert_user_profile("u1", {"avatar_config": cfg})
        upsert_user_profile("u1", {"avatar_config": None})
        p = get_user_profile("u1")
        assert p is not None
        assert p.avatar_config is None
