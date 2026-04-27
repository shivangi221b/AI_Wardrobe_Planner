"""
Product search for shop suggestions: SerpAPI Google Shopping, curated fallback, TTL cache.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Optional
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

import httpx

from .models import ShopProductOption

logger = logging.getLogger(__name__)

_SHOP_CACHE: dict[str, tuple[float, list[ShopProductOption]]] = {}


def _cache_ttl_sec() -> float:
    try:
        return max(60.0, float(os.getenv("SHOP_CACHE_TTL_SEC", "3600")))
    except ValueError:
        return 3600.0


def _cache_key(query: str, limit: int) -> str:
    raw = f"{query.strip().lower()}|{limit}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def cache_get(query: str, limit: int) -> Optional[list[ShopProductOption]]:
    key = _cache_key(query, limit)
    entry = _SHOP_CACHE.get(key)
    if not entry:
        logger.debug("shop_cache miss key=%s", key)
        return None
    expires_at, products = entry
    if time.monotonic() > expires_at:
        del _SHOP_CACHE[key]
        logger.debug("shop_cache expired key=%s", key)
        return None
    logger.info("shop_cache hit key=%s products=%d", key, len(products))
    return products


def cache_set(query: str, limit: int, products: list[ShopProductOption]) -> None:
    key = _cache_key(query, limit)
    ttl = _cache_ttl_sec()
    _SHOP_CACHE[key] = (time.monotonic() + ttl, products)


def _placeholder_image_url(title: str) -> str:
    """HTTPS placeholder so web clients never get mixed-content; short label for readability."""
    label = (title or "Product").strip()[:36] or "Product"
    safe = quote(label.replace("&", " "), safe=" ")
    return f"https://placehold.co/320x320/eaeaea/1a1a1a/png?text={safe}"


def _first_url(*candidates: object) -> str:
    for c in candidates:
        if c is None:
            continue
        if isinstance(c, str):
            u = c.strip()
            if u.startswith("//"):
                u = "https:" + u
            if u.startswith(("http://", "https://")):
                return u
        elif isinstance(c, list):
            for item in c:
                u = _first_url(item)
                if u:
                    return u
        elif isinstance(c, dict):
            u = _first_url(
                c.get("link"),
                c.get("url"),
                c.get("src"),
                c.get("thumbnail"),
                c.get("original"),
            )
            if u:
                return u
    return ""


def _extract_product_image_url(raw: dict[str, Any]) -> str:
    """
    SerpAPI shopping payloads vary: ``thumbnail``, ``serpapi_thumbnail``,
    ``thumbnails[]``, ``serpapi_thumbnails[]``, nested ``image``, etc.
    Prefer SerpApi-hosted URLs (often more reliable as img src than gstatic).
    """
    return _first_url(
        raw.get("serpapi_thumbnail"),
        raw.get("serpapi_thumbnails"),
        raw.get("thumbnail"),
        raw.get("thumbnails"),
        raw.get("image"),
        raw.get("img"),
        raw.get("img_src"),
        raw.get("images"),
    )


def append_affiliate_params(url: str) -> str:
    suffix = (os.getenv("SHOP_AFFILIATE_QUERY_SUFFIX") or "").strip()
    if not suffix or not url:
        return url
    parts = urlsplit(url)
    q = dict(parse_qsl(parts.query, keep_blank_values=True))
    for k, v in parse_qsl(suffix.lstrip("?"), keep_blank_values=True):
        if k and k not in q:
            q[k] = v
    new_query = urlencode(q)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, new_query, parts.fragment))


def normalize_shopping_result(raw: dict[str, Any], position: int) -> Optional[ShopProductOption]:
    title = (raw.get("title") or raw.get("name") or "").strip()
    link = (raw.get("link") or raw.get("product_link") or raw.get("tracking_link") or "").strip()
    image_url = _extract_product_image_url(raw)
    source = (raw.get("source") or raw.get("store") or raw.get("seller") or "").strip() or None
    price = raw.get("extracted_price")
    if price is None:
        price = raw.get("price")
    price_display = str(price).strip() if price not in (None, "") else None

    if not title or not link:
        return None
    if not image_url:
        image_url = _placeholder_image_url(title)

    pid = str(raw.get("product_id") or raw.get("product_id_internal") or f"r{position}")
    opt_id = hashlib.sha256(f"{link}|{title}|{pid}".encode()).hexdigest()[:16]

    merchant_url = link
    aff = append_affiliate_params(link)
    affiliate_url: Optional[str] = aff if aff != merchant_url else None

    return ShopProductOption(
        id=opt_id,
        title=title[:200],
        brand=source,
        price_display=price_display,
        image_url=image_url[:2048],
        merchant_url=merchant_url[:2048],
        affiliate_url=affiliate_url[:2048] if affiliate_url else None,
    )


class ProductProvider(ABC):
    @abstractmethod
    def search(self, query: str, limit: int = 4) -> list[ShopProductOption]:
        ...


def _iter_shopping_dicts(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Flatten SerpAPI ``shopping_results``, ``inline_shopping_results``, and categorized blocks."""
    rows: list[dict[str, Any]] = []
    for key in ("shopping_results", "inline_shopping_results"):
        chunk = data.get(key)
        if isinstance(chunk, list):
            rows.extend(x for x in chunk if isinstance(x, dict))
    categorized = data.get("categorized_shopping_results")
    if isinstance(categorized, list):
        for block in categorized:
            if not isinstance(block, dict):
                continue
            inner = block.get("shopping_results")
            if isinstance(inner, list):
                rows.extend(x for x in inner if isinstance(x, dict))
    return rows


class SerpApiShoppingProvider(ProductProvider):
    def search(self, query: str, limit: int = 4) -> list[ShopProductOption]:
        api_key = (os.getenv("SERPAPI_KEY") or "").strip()
        if not api_key:
            logger.warning("shop_serpapi skipped: missing SERPAPI_KEY")
            return []

        fetch_n = min(40, max(limit * 5, 12))
        params = {
            "engine": "google_shopping",
            "q": query,
            "api_key": api_key,
            "num": str(fetch_n),
        }
        t0 = time.perf_counter()
        try:
            with httpx.Client(timeout=httpx.Timeout(12.0, connect=5.0)) as client:
                resp = client.get("https://serpapi.com/search.json", params=params)
        except httpx.RequestError as exc:
            logger.exception("shop_serpapi request error: %s", type(exc).__name__)
            return []

        elapsed_ms = (time.perf_counter() - t0) * 1000
        logger.info(
            "shop_serpapi done status=%s elapsed_ms=%.1f query_len=%d",
            resp.status_code,
            elapsed_ms,
            len(query),
        )

        if resp.status_code != 200:
            logger.error("shop_serpapi bad status body_prefix=%s", (resp.text or "")[:200])
            return []

        try:
            data = resp.json()
        except json.JSONDecodeError:
            logger.error("shop_serpapi invalid json")
            return []

        results = _iter_shopping_dicts(data)
        if not results:
            legacy = data.get("shopping_results") or data.get("organic_results") or []
            if isinstance(legacy, list):
                results = [x for x in legacy if isinstance(x, dict)]

        scored: list[tuple[int, int, ShopProductOption]] = []
        seen_link: set[str] = set()
        for i, row in enumerate(results):
            opt = normalize_shopping_result(row, i)
            if not opt:
                continue
            key = opt.merchant_url.lower()
            if key in seen_link:
                continue
            seen_link.add(key)
            has_real = bool(_extract_product_image_url(row))
            primary = 0 if has_real else 1
            scored.append((primary, i, opt))

        scored.sort(key=lambda t: (t[0], t[1]))
        out = [t[2] for t in scored[:limit]]
        return out


class CuratedProductProvider(ProductProvider):
    def __init__(self, path: Optional[Path] = None) -> None:
        root = Path(__file__).resolve().parents[1]
        self._path = path or Path(
            os.getenv("SHOP_CURATED_JSON", str(root / "data" / "shop_curated_products.json"))
        )

    def _load_blob(self) -> dict[str, Any]:
        if not self._path.is_file():
            return {}
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return data if isinstance(data, dict) else {}

    def for_gap(self, gap_id: str, limit: int = 4) -> list[ShopProductOption]:
        blob = self._load_blob()
        rows = blob.get(gap_id) or []
        if not isinstance(rows, list):
            return []
        out: list[ShopProductOption] = []
        for i, row in enumerate(rows):
            if len(out) >= limit:
                break
            if not isinstance(row, dict):
                continue
            opt = normalize_shopping_result(row, i)
            if opt:
                out.append(opt)
        return out

    def search(self, query: str, limit: int = 4) -> list[ShopProductOption]:
        blob = self._load_blob()
        if not blob:
            return []
        rows = blob.get("_default") or next(iter(blob.values()), [])
        if not isinstance(rows, list):
            return []
        out: list[ShopProductOption] = []
        for i, row in enumerate(rows):
            if len(out) >= limit:
                break
            if not isinstance(row, dict):
                continue
            opt = normalize_shopping_result(row, i)
            if opt:
                out.append(opt)
        return out


def search_products_cached(gap_id: str, query: str, limit: int = 4) -> list[ShopProductOption]:
    cache_query = f"{gap_id}|{query}"
    cached = cache_get(cache_query, limit)
    if cached is not None:
        return cached
    mode = (os.getenv("SHOP_PRODUCT_PROVIDER") or "serpapi").strip().lower()
    curated = CuratedProductProvider()
    products: list[ShopProductOption] = []
    if mode == "curated":
        products = curated.for_gap(gap_id, limit)
        if not products:
            products = curated.search(query, limit)
    else:
        products = SerpApiShoppingProvider().search(query, limit)
        if not products:
            products = curated.for_gap(gap_id, limit)
        if not products:
            products = curated.search(query, limit)
    if products:
        cache_set(cache_query, limit, products)
    return products
