"""Integration tests for wardrobe endpoints."""

from __future__ import annotations

import pytest


@pytest.mark.usefixtures("_isolate_env")
class TestGetWardrobe:
    async def test_empty_wardrobe(self, client):
        resp = await client.get("/wardrobe/new-user")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_after_adding_item(self, client):
        add_resp = await client.post(
            "/wardrobe/test-user/items",
            json={
                "name": "Blue shirt",
                "category": "top",
                "color": "blue",
                "primary_image_url": "https://example.com/img.jpg",
            },
        )
        assert add_resp.status_code == 200

        resp = await client.get("/wardrobe/test-user")
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) >= 1
        assert items[0]["category"] == "top"


@pytest.mark.usefixtures("_isolate_env")
class TestAddWardrobe:
    async def test_valid_add(self, client):
        resp = await client.post(
            "/wardrobe/test-user/items",
            json={
                "name": "Red pants",
                "category": "bottom",
                "color": "red",
                "primary_image_url": "https://example.com/pants.jpg",
                "brand": "Levi's",
                "size": "M",
                "fit_notes": "Slim fit",
                "price": 69.99,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["category"] == "bottom"
        assert data["user_id"] == "test-user"
        assert data["brand"] == "Levi's"
        assert data["size"] == "M"
        assert "Receipt price: $69.99" in (data.get("fit_notes") or "")

    async def test_invalid_category_rejected(self, client):
        resp = await client.post(
            "/wardrobe/test-user/items",
            json={
                "name": "Thing",
                "category": "spaceship",
                "primary_image_url": "https://example.com/img.jpg",
            },
        )
        assert resp.status_code == 422

    async def test_missing_name_rejected(self, client):
        resp = await client.post(
            "/wardrobe/test-user/items",
            json={
                "category": "top",
                "primary_image_url": "https://example.com/img.jpg",
            },
        )
        assert resp.status_code == 422


@pytest.mark.usefixtures("_isolate_env")
class TestSearchGarment:
    async def test_missing_serpapi_key(self, client):
        resp = await client.post(
            "/wardrobe/test-user/search-garment",
            json={"query": "black shirt"},
        )
        assert resp.status_code == 503

    async def test_empty_query(self, client, monkeypatch):
        monkeypatch.setenv("SERPAPI_KEY", "fake-key")
        resp = await client.post(
            "/wardrobe/test-user/search-garment",
            json={"query": ""},
        )
        assert resp.status_code == 400


@pytest.mark.usefixtures("_isolate_env")
class TestReceiptParser:
    async def test_parse_receipt_text(self, client):
        resp = await client.post(
            "/wardrobe/test-user/receipt/parse",
            json={
                "source": "text",
                "content": (
                    "UNIQLO\\n"
                    "Black T-shirt M $19.90\\n"
                    "Navy Chinos 32 $49.90\\n"
                    "Subtotal $69.80\\n"
                ),
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["parser_strategy"] == "text_rules"
        assert isinstance(data["parsed_items"], list)
        assert len(data["parsed_items"]) >= 2
        assert data["parsed_items"][0]["name"]
        assert data["parsed_items"][0]["category"] in {
            "top",
            "bottom",
            "dress",
            "outerwear",
            "shoes",
            "accessory",
        }

    async def test_parse_receipt_upload_text_file(self, client):
        resp = await client.post(
            "/wardrobe/test-user/receipt/parse-upload",
            data={"source": "email"},
            files={
                "file": (
                    "receipt.txt",
                    b"Nike Running Shoes 10 $99.00\\nTax $8.00\\nTotal $107.00",
                    "text/plain",
                )
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["parser_strategy"] == "plain_text_rules"
        assert isinstance(data["parsed_items"], list)
        assert len(data["parsed_items"]) >= 1

    async def test_parse_receipt_empty_content_rejected(self, client):
        resp = await client.post(
            "/wardrobe/test-user/receipt/parse",
            json={"source": "text", "content": "   "},
        )
        assert resp.status_code == 400
