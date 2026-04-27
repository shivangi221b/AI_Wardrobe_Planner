"""Unit tests for SerpAPI shopping provider parsing."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from backend.shop_products import SerpApiShoppingProvider, normalize_shopping_result


def test_normalize_shopping_result_minimal():
    opt = normalize_shopping_result(
        {
            "title": "Test shoe",
            "link": "https://merchant.example/p/1",
            "thumbnail": "https://img.example/i.jpg",
            "source": "Merchant",
            "extracted_price": 99,
        },
        0,
    )
    assert opt is not None
    assert opt.title == "Test shoe"
    assert opt.merchant_url.startswith("https://merchant.example")
    assert "99" in (opt.price_display or "")


def test_serpapi_provider_parses_json(monkeypatch):
    monkeypatch.setenv("SERPAPI_KEY", "fake-key-for-test")

    fake_resp = MagicMock()
    fake_resp.status_code = 200
    fake_resp.json.return_value = {
        "shopping_results": [
            {
                "title": "Loafer",
                "link": "https://shop.example/l",
                "thumbnail": "https://shop.example/t.jpg",
                "source": "Shop",
                "extracted_price": "$120",
            }
        ]
    }

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get(self, _url, params=None):
            return fake_resp

    with patch("backend.shop_products.httpx.Client", return_value=FakeClient()):
        out = SerpApiShoppingProvider().search("loafers", 4)

    assert len(out) == 1
    assert out[0].title == "Loafer"
