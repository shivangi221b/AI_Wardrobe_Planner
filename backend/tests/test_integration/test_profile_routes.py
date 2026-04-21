"""Integration tests for the user profile endpoints.

Covers:
- GET /users/{user_id}/profile → 404 when profile has never been saved
- PUT /users/{user_id}/profile → creates a new profile
- PUT (partial) → updates without clobbering omitted fields
- PUT with explicit null → clears a stored field
- avatar_config round-trip (including avatar_image_url for generated portrait)
"""

from __future__ import annotations

import pytest
import httpx
from fastapi import FastAPI
from httpx import ASGITransport

from backend.routers import profile_router
from backend.db import _local_user_profiles


@pytest.fixture(autouse=True)
def _clear_profiles():
    _local_user_profiles.clear()
    yield
    _local_user_profiles.clear()


@pytest.fixture()
def app() -> FastAPI:
    a = FastAPI()
    a.include_router(profile_router.router)
    return a


@pytest.fixture()
async def client(app, _isolate_env):
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


# ---------------------------------------------------------------------------
# GET — missing profile
# ---------------------------------------------------------------------------


class TestGetProfile:
    async def test_404_when_profile_not_found(self, client):
        r = await client.get("/users/nobody/profile")
        assert r.status_code == 404
        assert "not found" in r.json()["detail"].lower()

    async def test_200_after_upsert(self, client):
        await client.put("/users/u1/profile", json={"gender": "female"})
        r = await client.get("/users/u1/profile")
        assert r.status_code == 200
        assert r.json()["gender"] == "female"


# ---------------------------------------------------------------------------
# PUT — create and partial update
# ---------------------------------------------------------------------------


class TestPutProfile:
    async def test_create_returns_full_profile(self, client):
        r = await client.put(
            "/users/u1/profile",
            json={
                "gender": "male",
                "skin_tone": "medium",
                "favorite_colors": ["blue", "navy"],
            },
        )
        assert r.status_code == 200
        data = r.json()
        assert data["gender"] == "male"
        assert data["skin_tone"] == "medium"
        assert data["favorite_colors"] == ["blue", "navy"]

    async def test_partial_update_does_not_clobber_omitted_fields(self, client):
        # Seed full profile
        await client.put(
            "/users/u1/profile",
            json={"gender": "female", "color_tone": "warm", "shoe_size": "38"},
        )
        # Partial update — only update shoe_size
        r = await client.put("/users/u1/profile", json={"shoe_size": "39"})
        assert r.status_code == 200
        data = r.json()
        # Omitted fields must remain unchanged
        assert data["gender"] == "female"
        assert data["color_tone"] == "warm"
        assert data["shoe_size"] == "39"

    async def test_idempotent_put(self, client):
        await client.put("/users/u1/profile", json={"gender": "other"})
        r = await client.put("/users/u1/profile", json={"gender": "other"})
        assert r.status_code == 200

    async def test_avatar_config_round_trip(self, client):
        r = await client.put(
            "/users/u1/profile",
            json={
                "avatar_config": {
                    "hair_style": "long_straight",
                    "hair_color": "black",
                    "body_type": "slim",
                    "skin_tone": "medium_dark",
                }
            },
        )
        assert r.status_code == 200
        cfg = r.json()["avatar_config"]
        assert cfg["hair_style"] == "long_straight"
        assert cfg["hair_color"] == "black"
        assert cfg["skin_tone"] == "medium_dark"

    async def test_avatar_image_url_persisted(self, client):
        r = await client.put(
            "/users/u1/profile",
            json={"avatar_config": {"avatar_image_url": "https://example.com/avatar.jpg"}},
        )
        assert r.status_code == 200
        assert r.json()["avatar_config"]["avatar_image_url"] == "https://example.com/avatar.jpg"


# ---------------------------------------------------------------------------
# PUT with explicit null → clears stored values
# ---------------------------------------------------------------------------


class TestExplicitNullClears:
    async def test_null_clears_scalar_field(self, client):
        await client.put("/users/u1/profile", json={"shoe_size": "42"})

        r = await client.put("/users/u1/profile", json={"shoe_size": None})
        assert r.status_code == 200
        assert r.json()["shoe_size"] is None

    async def test_null_clears_avatar_config(self, client):
        await client.put(
            "/users/u1/profile",
            json={"avatar_config": {"hair_style": "short_wavy"}},
        )
        r = await client.put("/users/u1/profile", json={"avatar_config": None})
        assert r.status_code == 200
        assert r.json()["avatar_config"] is None

    async def test_null_clears_list_field(self, client):
        await client.put(
            "/users/u1/profile",
            json={"favorite_colors": ["red", "orange"]},
        )
        r = await client.put("/users/u1/profile", json={"favorite_colors": None})
        assert r.status_code == 200
        # Cleared list — stored as empty by the local store helper
        assert r.json()["favorite_colors"] in (None, [])
