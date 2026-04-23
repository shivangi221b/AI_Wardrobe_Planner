"""
Post-filter SerpAPI Google Images hits for wardrobe Search & Add.

Google often returns off-topic images; we rank down obvious non-apparel and
boost rows whose title/URL align with the user's fashion tokens.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

# Tokens shorter than this are ignored for "required" matching (too noisy).
_MIN_TOKEN_LEN = 3

_STOPWORDS: frozenset[str] = frozenset(
    {
        "the",
        "and",
        "for",
        "with",
        "from",
        "this",
        "that",
        "your",
        "our",
        "are",
        "was",
        "has",
        "have",
        "not",
        "but",
        "all",
        "any",
        "can",
        "get",
        "you",
        "how",
        "new",
        "best",
        "top",
        "free",
        "buy",
        "sale",
        "shop",
        "online",
        "stock",
        "image",
        "images",
        "photo",
        "picture",
        "png",
        "jpg",
        "jpeg",
        "svg",
        "icon",
        "vector",
        "clipart",
        "illustration",
        "drawing",
        "cartoon",
        "logo",
        "brand",
        "product",
        "clothing",
        "fashion",
        "wear",
        "outfit",
        "style",
        "studio",
        "background",
        "white",
        "isolated",
        "flat",
        "lay",
    }
)

# Strong signals the hit is probably not a garment photo.
_NEGATIVE_WORDS: frozenset[str] = frozenset(
    {
        "wallpaper",
        "meme",
        "minecraft",
        "roblox",
        "fortnite",
        "anime",
        "manga",
        "nft",
        "crypto",
        "bitcoin",
        "recipe",
        "food",
        "cake",
        "pizza",
        "restaurant",
        "furniture",
        "sofa",
        "couch",
        "chair",
        "table",
        "desk",
        "lamp",
        "kitchen",
        "bathroom",
        "bedroom",
        "interior",
        "laptop",
        "iphone",
        "samsung",
        "phone",
        "computer",
        "monitor",
        "keyboard",
        "mouse",
        "gadget",
        "car",
        "truck",
        "suv",
        "motorcycle",
        "bike",
        "bicycle",
        "tire",
        "engine",
        "weapon",
        "gun",
        "rifle",
        "tattoo",
        "piercing",
        "wedding",
        "engagement",
        "diamond",
        "ring",
        "necklace",
        "jewelry",
        "watch",
        "rolex",
        "cosmetic",
        "makeup",
        "lipstick",
        "perfume",
        "skincare",
        "plant",
        "flower",
        "tree",
        "landscape",
        "sunset",
        "ocean",
        "beach",
        "mountain",
        "dog",
        "cat",
        "puppy",
        "kitten",
        "baby",
        "toddler",
        "family",
        "portrait",
        "face",
        "selfie",
        "haircut",
        "salon",
        "nail",
        "art",
        "painting",
        "poster",
        "printable",
        "template",
        "ppt",
        "powerpoint",
        "excel",
        "pdf",
        "diagram",
        "map",
        "flag",
        "country",
        "building",
        "skyline",
        "architecture",
    }
)

# Light bonus if title/url hints at apparel (helps when query tokens are brand-only).
_APPAREL_HINTS: frozenset[str] = frozenset(
    {
        "shirt",
        "tee",
        "t-shirt",
        "blouse",
        "top",
        "sweater",
        "cardigan",
        "hoodie",
        "jacket",
        "coat",
        "blazer",
        "vest",
        "dress",
        "skirt",
        "jean",
        "jeans",
        "pant",
        "pants",
        "trouser",
        "short",
        "shorts",
        "legging",
        "jogger",
        "suit",
        "oxford",
        "polo",
        "turtleneck",
        "sneaker",
        "sneakers",
        "shoe",
        "shoes",
        "boot",
        "boots",
        "loafer",
        "heel",
        "heels",
        "sandal",
        "flats",
        "sock",
        "belt",
        "bag",
        "handbag",
        "scarf",
        "hat",
        "beanie",
        "glove",
        "tie",
        "bow",
        "lingerie",
        "bra",
        "underwear",
        "swimwear",
        "bikini",
        "trunks",
        "activewear",
        "sportswear",
        "athletic",
        "denim",
        "knit",
        "wool",
        "linen",
        "cotton",
        "leather",
        "suede",
        "outerwear",
        "parka",
        "windbreaker",
    }
)


def _tokenize(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) >= _MIN_TOKEN_LEN}


def _token_appears_in_lower_text(token: str, hay_lower: str) -> bool:
    """
    Match token in *hay_lower* (must already be lowercased) without substring traps
    (e.g. "top" in "laptop", "car" in "scarf"). Short tokens use word-boundary style
    checks; longer tokens use substring.
    """
    t = token.lower()
    if len(t) <= 5:
        try:
            return bool(re.search(rf"(?<![a-z0-9]){re.escape(t)}(?![a-z0-9])", hay_lower))
        except re.error:
            return t in hay_lower
    return t in hay_lower


def _token_appears_in_text(token: str, text: str) -> bool:
    """Like ``_token_appears_in_lower_text`` but lowercases *text* once (arbitrary case)."""
    return _token_appears_in_lower_text(token, text.lower())


def _fashion_tokens_from_search(
    base_query: str,
    color: str | None,
    material: str | None,
    kind: str | None,
) -> set[str]:
    parts: list[str] = [base_query]
    if color:
        parts.append(str(color))
    if material:
        parts.append(str(material))
    if kind:
        parts.append(str(kind))
    blob = " ".join(parts)
    tokens = _tokenize(blob)
    return {t for t in tokens if t not in _STOPWORDS}


def _result_text_blob(item: dict[str, Any]) -> str:
    title = item.get("title") if isinstance(item.get("title"), str) else ""
    link = item.get("link") if isinstance(item.get("link"), str) else ""
    orig = item.get("original") if isinstance(item.get("original"), str) else ""
    thumb = item.get("thumbnail") if isinstance(item.get("thumbnail"), str) else ""
    return f"{title} {link} {orig} {thumb}".lower()


def _score_image_result(item: dict[str, Any], required_tokens: set[str]) -> float:
    blob = _result_text_blob(item)
    score = 0.0

    for w in _NEGATIVE_WORDS:
        if _token_appears_in_lower_text(w, blob):
            score -= 4.0

    matched_required = 0
    for t in required_tokens:
        if _token_appears_in_lower_text(t, blob):
            score += 3.0
            matched_required += 1

    # If user gave specific tokens, penalize rows that match none (weak garment signal).
    if required_tokens and matched_required == 0:
        score -= 2.0

    hint_hits = sum(1 for h in _APPAREL_HINTS if _token_appears_in_lower_text(h, blob))
    if hint_hits:
        score += min(2.0, 0.4 * hint_hits)

    return score


def filter_and_rank_image_results(
    raw_items: Iterable[dict[str, Any]],
    *,
    base_query: str,
    color: str | None,
    material: str | None,
    kind: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    """
    Drop worst off-topic rows and return up to *limit* items, best scores first.

    If every row would be hard-dropped, fall back to the full list in **score order**
    (same sort as above), still capped and deduped by image URL.
    """
    items = [it for it in raw_items if isinstance(it, dict)]
    if not items:
        return []

    required = _fashion_tokens_from_search(base_query, color, material, kind)

    scored: list[tuple[float, dict[str, Any]]] = [
        (_score_image_result(it, required), it) for it in items
    ]
    scored.sort(key=lambda x: x[0], reverse=True)

    # Hard-drop only the strongest junk (very negative score).
    strong_junk_threshold = -8.0
    kept = [it for s, it in scored if s > strong_junk_threshold]

    if not kept:
        kept = [it for _, it in scored]

    out: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for it in kept:
        link = it.get("original") or it.get("thumbnail")
        if not isinstance(link, str) or not link.strip():
            continue
        u = link.strip()
        if u in seen_urls:
            continue
        seen_urls.add(u)
        out.append(it)
        if len(out) >= limit:
            break

    return out
