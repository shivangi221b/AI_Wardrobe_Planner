"""Integration tests for POST /users/{user_id}/avatar/generate."""

from __future__ import annotations

import io
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from httpx import ASGITransport
from fastapi import FastAPI
from PIL import Image

from backend.db import _local_user_profiles
from backend.routers import avatar_router


def _minimal_jpeg_bytes() -> bytes:
    im = Image.new("RGB", (4, 4), color=(120, 80, 60))
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def _minimal_png_bytes() -> bytes:
    im = Image.new("RGBA", (4, 4), color=(20, 40, 80, 255))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _clear_profiles():
    _local_user_profiles.clear()
    yield
    _local_user_profiles.clear()


@pytest.fixture()
def app() -> FastAPI:
    a = FastAPI()
    a.include_router(avatar_router.router)
    return a


@pytest.fixture()
async def client(app, _isolate_env):
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
class TestAvatarGenerate:
    async def test_empty_upload_400(self, client):
        files = {"selfie": ("selfie.jpg", b"", "image/jpeg")}
        r = await client.post("/users/u1/avatar/generate", files=files)
        assert r.status_code == 400
        assert "empty" in r.json()["detail"].lower()

    async def test_invalid_bytes_400(self, client):
        files = {"selfie": ("selfie.jpg", b"not an image at all", "image/jpeg")}
        r = await client.post("/users/u1/avatar/generate", files=files)
        assert r.status_code == 400
        assert "decode" in r.json()["detail"].lower() or "valid" in r.json()["detail"].lower()

    async def test_payload_too_large_413(self, client, monkeypatch):
        monkeypatch.setattr(avatar_router, "_MAX_UPLOAD_BYTES", 500)
        big = _minimal_jpeg_bytes() * 80
        assert len(big) > 500
        r = await client.post(
            "/users/u1/avatar/generate",
            files={"selfie": ("selfie.jpg", big, "image/jpeg")},
        )
        assert r.status_code == 413

    @patch("backend.routers.avatar_router.store_avatar_image", return_value="https://example.com/avatars/u1.jpg")
    @patch(
        "backend.routers.avatar_router.generate_avatar_image",
        new_callable=AsyncMock,
        return_value=b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9",
    )
    async def test_success_updates_avatar_image_url(self, mock_gen, mock_store, client):
        from backend.db import upsert_user_profile

        upsert_user_profile(
            "u1",
            {
                "gender": "male",
                "avatar_config": {
                    "hair_style": "short_wavy",
                    "hair_color": "brown",
                    "skin_tone": "medium",
                },
            },
        )
        jpeg = _minimal_jpeg_bytes()
        # Mislabel as image/jpeg while sending PNG bytes — router must sniff actual format.
        files = {"selfie": ("wrong.jpg", jpeg, "image/png")}
        r = await client.post("/users/u1/avatar/generate", files=files)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["avatar_image_url"] == "https://example.com/avatars/u1.jpg"
        mock_gen.assert_awaited_once()
        call_kw = mock_gen.await_args.kwargs
        assert call_kw["selfie_mime"] == "image/jpeg"
        assert call_kw["gender"] == "male"
        mock_store.assert_called_once()

        from backend.db import get_user_profile

        p = get_user_profile("u1")
        assert p is not None
        assert p.avatar_config is not None
        assert p.avatar_config.avatar_image_url == "https://example.com/avatars/u1.jpg"
        assert p.avatar_config.hair_style == "short_wavy"

    @patch("backend.routers.avatar_router.store_avatar_image", return_value="https://example.com/x.png")
    @patch("backend.routers.avatar_router.generate_avatar_image", new_callable=AsyncMock, return_value=b"jpeg-out")
    async def test_png_upload_sniffed(self, mock_gen, mock_store, client):
        png = _minimal_png_bytes()
        files = {"selfie": ("face.jpeg", png, "image/jpeg")}
        r = await client.post("/users/u2/avatar/generate", files=files)
        assert r.status_code == 200
        assert mock_gen.await_args.kwargs["selfie_mime"] == "image/png"
