"""Email/password auth routes (isolated app — avoids importing ``backend.main`` / vision stack)."""

from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI
from httpx import ASGITransport

from backend.routers import auth_router


@pytest.mark.usefixtures("_isolate_env")
class TestAuthRoutes:
    async def _client(self):
        app = FastAPI()
        app.include_router(auth_router.router)
        transport = ASGITransport(app=app)
        return httpx.AsyncClient(transport=transport, base_url="http://test")

    async def test_register_and_login(self, monkeypatch):
        c = await self._client()
        async with c:
            r = await c.post(
                "/auth/register",
                json={"email": "  Hello@Example.COM ", "password": "hunter42!"},
            )
            assert r.status_code == 201
            data = r.json()
            assert data["email"] == "hello@example.com"
            assert data["user_id"] == "email-hello-at-example-dot-com"

            login = await c.post(
                "/auth/login",
                json={"email": "hello@example.com", "password": "hunter42!"},
            )
            assert login.status_code == 200
            assert login.json()["user_id"] == data["user_id"]

    async def test_register_duplicate(self, monkeypatch):
        c = await self._client()
        async with c:
            await c.post(
                "/auth/register",
                json={"email": "dup@example.com", "password": "password1"},
            )
            r2 = await c.post(
                "/auth/register",
                json={"email": "dup@example.com", "password": "otherpass1"},
            )
            assert r2.status_code == 409

    async def test_login_wrong_password(self, monkeypatch):
        c = await self._client()
        async with c:
            await c.post(
                "/auth/register",
                json={"email": "u@example.com", "password": "correct12"},
            )
            bad = await c.post(
                "/auth/login",
                json={"email": "u@example.com", "password": "wrongpass"},
            )
            assert bad.status_code == 401

    async def test_register_weak_password(self, monkeypatch):
        c = await self._client()
        async with c:
            r = await c.post(
                "/auth/register",
                json={"email": "x@example.com", "password": "short"},
            )
            assert r.status_code in (400, 422)
