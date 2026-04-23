from __future__ import annotations

import io
import logging
import re
from typing import Any, Optional

from vision.extractor import extract_receipt_items_from_image

logger = logging.getLogger(__name__)

CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "top": (
        "shirt",
        "t-shirt",
        "tee",
        "blouse",
        "sweater",
        "hoodie",
        "cardigan",
        "blazer",
        "polo",
        "tank",
        "top",
    ),
    "bottom": (
        "jeans",
        "pants",
        "trouser",
        "shorts",
        "skirt",
        "leggings",
        "chinos",
        "bottom",
    ),
    "dress": ("dress", "jumpsuit"),
    "outerwear": (
        "jacket",
        "coat",
        "parka",
        "trench",
        "windbreaker",
        "outerwear",
    ),
    "shoes": (
        "shoe",
        "sneaker",
        "loafer",
        "heel",
        "boot",
        "sandals",
        "slippers",
    ),
    "accessory": (
        "bag",
        "belt",
        "hat",
        "cap",
        "scarf",
        "watch",
        "sunglasses",
        "wallet",
        "bracelet",
        "necklace",
        "earring",
        "ring",
    ),
}

COLOR_WORDS = {
    "black",
    "white",
    "gray",
    "grey",
    "blue",
    "navy",
    "brown",
    "green",
    "olive",
    "red",
    "pink",
    "purple",
    "beige",
    "cream",
    "tan",
    "khaki",
    "orange",
    "yellow",
    "gold",
    "silver",
}

KNOWN_BRANDS = {
    "nike",
    "adidas",
    "zara",
    "h&m",
    "hm",
    "uniqlo",
    "gap",
    "levis",
    "levi's",
    "j.crew",
    "jcrew",
    "mango",
    "patagonia",
    "lululemon",
    "new balance",
    "vans",
    "calvin klein",
    "ralph lauren",
    "tommy hilfiger",
    "banana republic",
    "everlane",
    "madewell",
}

NON_ITEM_TERMS = (
    "subtotal",
    "total",
    "tax",
    "shipping",
    "discount",
    "promo",
    "order",
    "invoice",
    "receipt",
    "payment",
    "card",
    "visa",
    "mastercard",
    "thank",
    "return policy",
)

PRICE_RE = re.compile(r"(?:usd\s*)?\$\s*(\d{1,4}(?:[\.,]\d{2})?)", re.IGNORECASE)
ALT_PRICE_RE = re.compile(r"\b(\d{1,4}[\.,]\d{2})\b")
SIZE_RE = re.compile(
    r"\b(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|[0-9]{1,2}(?:\.[05])?|W[0-9]{2}L[0-9]{2})\b",
    re.IGNORECASE,
)
SKU_RE = re.compile(r"\b(?:sku|item|style|id|#)[:\-\s]*[a-z0-9\-]+\b", re.IGNORECASE)
QTY_RE = re.compile(r"^(?:qty\s*)?[x\*]?[0-9]+\s+", re.IGNORECASE)


def _normalize_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def _title_case_words(value: str) -> str:
    words = [part for part in re.split(r"\s+", value.strip()) if part]
    return " ".join(w[:1].upper() + w[1:] for w in words)


def _parse_price(value: str) -> Optional[float]:
    if not value:
        return None
    match = PRICE_RE.search(value) or ALT_PRICE_RE.search(value)
    if not match:
        return None
    raw = match.group(1).replace(",", ".").strip()
    try:
        return round(float(raw), 2)
    except Exception:
        return None


def _extract_size(value: str) -> Optional[str]:
    match = SIZE_RE.search(value or "")
    if not match:
        return None
    return match.group(1).upper()


def _extract_color(value: str) -> Optional[str]:
    words = [w.lower().strip(".,:;()[]{}") for w in (value or "").split()]
    for token in words:
        if token in COLOR_WORDS:
            return token
    return None


def infer_category(item_text: str) -> str:
    text = (item_text or "").lower()
    for category, hints in CATEGORY_KEYWORDS.items():
        for hint in hints:
            if hint in text:
                return category
    return "top"


def _looks_like_item_line(line: str) -> bool:
    normalized = (line or "").strip().lower()
    if len(normalized) < 4:
        return False
    if any(term in normalized for term in NON_ITEM_TERMS):
        return False
    has_price = bool(_parse_price(normalized) is not None)
    has_clothing_hint = any(
        hint in normalized
        for hints in CATEGORY_KEYWORDS.values()
        for hint in hints
    )
    return has_price or has_clothing_hint


def _clean_item_name(raw_line: str) -> str:
    line = _normalize_spaces(raw_line)
    line = PRICE_RE.sub("", line)
    line = ALT_PRICE_RE.sub("", line)
    line = SIZE_RE.sub("", line)
    line = SKU_RE.sub("", line)
    line = QTY_RE.sub("", line)
    line = re.sub(r"\b(?:qty|quantity|item|color|size)\b[:\-]?", "", line, flags=re.IGNORECASE)
    line = re.sub(r"[^A-Za-z0-9\-\s'&]", " ", line)
    line = _normalize_spaces(line)
    if not line:
        return ""
    return _title_case_words(line)


def _extract_brand(line: str, header_brand: Optional[str]) -> Optional[str]:
    lower = (line or "").lower()
    for brand in KNOWN_BRANDS:
        if brand in lower:
            return _title_case_words(brand)
    return header_brand


def _find_header_brand(lines: list[str]) -> Optional[str]:
    head = " ".join(lines[:6]).lower()
    for brand in KNOWN_BRANDS:
        if brand in head:
            return _title_case_words(brand)
    return None


def _confidence_score(
    *,
    has_price: bool,
    has_size: bool,
    has_color: bool,
    has_brand: bool,
    category_found: bool,
) -> float:
    score = 0.3
    if category_found:
        score += 0.25
    if has_price:
        score += 0.2
    if has_size:
        score += 0.1
    if has_color:
        score += 0.07
    if has_brand:
        score += 0.08
    return max(0.0, min(0.99, round(score, 2)))


def _build_item_dict(
    *,
    name: str,
    line: str,
    header_brand: Optional[str],
    source: str,
) -> dict[str, Any]:
    price = _parse_price(line)
    size = _extract_size(line)
    color = _extract_color(line)
    brand = _extract_brand(line, header_brand)
    category = infer_category(name or line)
    category_found = any(
        hint in (line or "").lower()
        for hint in CATEGORY_KEYWORDS.get(category, ())
    )
    confidence = _confidence_score(
        has_price=price is not None,
        has_size=size is not None,
        has_color=color is not None,
        has_brand=brand is not None,
        category_found=category_found,
    )
    return {
        "name": name,
        "brand": brand,
        "size": size,
        "color": color,
        "category": category,
        "price": price,
        "confidence": confidence,
        "needs_confirmation": confidence < 0.75,
        "source_line": _normalize_spaces(line),
        "source": source,
    }


def parse_receipt_text(content: str, source: str = "text") -> list[dict[str, Any]]:
    text = content or ""
    lines = [_normalize_spaces(line) for line in text.splitlines()]
    lines = [line for line in lines if line]
    if not lines:
        return []

    header_brand = _find_header_brand(lines)
    results: list[dict[str, Any]] = []
    seen_keys: set[tuple[str, str]] = set()

    for line in lines:
        if not _looks_like_item_line(line):
            continue
        name = _clean_item_name(line)
        if not name:
            continue
        item = _build_item_dict(name=name, line=line, header_brand=header_brand, source=source)
        dedupe_key = (item["name"].lower(), f"{item.get('price')}")
        if dedupe_key in seen_keys:
            continue
        seen_keys.add(dedupe_key)
        results.append(item)

    if results:
        return results

    # Fallback for unstructured text blobs: detect any clothing keywords in free text.
    blob = " ".join(lines)
    lowered = blob.lower()
    for hints in CATEGORY_KEYWORDS.values():
        for hint in hints:
            if hint not in lowered:
                continue
            snippet_match = re.search(rf"([A-Za-z0-9\s\-]{{0,24}}\b{re.escape(hint)}\b[A-Za-z0-9\s\-]{{0,24}})", blob, re.IGNORECASE)
            snippet = _normalize_spaces(snippet_match.group(1) if snippet_match else hint)
            name = _clean_item_name(snippet) or _title_case_words(hint)
            item = _build_item_dict(name=name, line=snippet, header_brand=header_brand, source=source)
            item["confidence"] = min(float(item["confidence"]), 0.59)
            item["needs_confirmation"] = True
            dedupe_key = (item["name"].lower(), f"{item.get('price')}")
            if dedupe_key in seen_keys:
                continue
            seen_keys.add(dedupe_key)
            results.append(item)
            break

    return results


def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    """Best-effort PDF text extraction using pypdf when available."""
    if not pdf_bytes:
        return ""
    try:
        from pypdf import PdfReader  # type: ignore
    except Exception:
        logger.info("pypdf unavailable; falling back to byte decode for PDF parsing")
        return pdf_bytes.decode("utf-8", errors="ignore")

    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n".join(pages).strip()
    except Exception:
        logger.exception("PDF extraction failed")
        return ""


def parse_receipt_image_bytes(image_bytes: bytes, mime_type: str) -> list[dict[str, Any]]:
    """
    Receipt parsing for screenshots/photos using the same Gemini vision stack
    as garment extraction (see ``vision/extractor.py``).
    """
    if not image_bytes:
        return []

    raw_items = extract_receipt_items_from_image(image_bytes, mime_type or "image/jpeg")
    if not raw_items:
        return []

    out: list[dict[str, Any]] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        name = _normalize_spaces(str(item.get("name") or ""))
        if not name:
            continue
        brand = item.get("brand")
        size = item.get("size")
        color = item.get("color")
        price_raw = item.get("price")
        confidence_raw = item.get("confidence")

        category_raw = str(item.get("category") or "").strip().lower()
        category = category_raw if category_raw in CATEGORY_KEYWORDS else infer_category(name)

        try:
            price = round(float(price_raw), 2) if price_raw not in (None, "") else None
        except Exception:
            price = None

        try:
            confidence = max(0.0, min(0.99, float(confidence_raw)))
        except Exception:
            confidence = _confidence_score(
                has_price=price is not None,
                has_size=bool(size),
                has_color=bool(color),
                has_brand=bool(brand),
                category_found=True,
            )

        out.append(
            {
                "name": name,
                "brand": _normalize_spaces(str(brand)) if brand not in (None, "") else None,
                "size": _normalize_spaces(str(size)) if size not in (None, "") else None,
                "color": _normalize_spaces(str(color)).lower() if color not in (None, "") else None,
                "category": category,
                "price": price,
                "confidence": round(confidence, 2),
                "needs_confirmation": confidence < 0.75,
                "source_line": None,
                "source": "screenshot",
            }
        )

    return out
