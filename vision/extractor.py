from __future__ import annotations

import io
import json
import logging
import os
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, List, Optional

from google import genai
from google.genai import types
from PIL import Image
from PIL import UnidentifiedImageError

from .image_gen import generate_garment_image

logger = logging.getLogger(__name__)

try:
    # Adds HEIF/HEIC support to Pillow's Image.open().
    import pillow_heif

    pillow_heif.register_heif_opener()
    _heic_enabled = True
except Exception:
    _heic_enabled = False


def _product_prompt_for_item(raw: dict[str, Any]) -> str:
    """Build a text-to-image product prompt from extracted item fields."""
    color = (str(raw.get("color") or "").strip()) or "neutral"
    raw_pattern = (str(raw.get("pattern") or "").strip().lower())
    if raw_pattern in ("", "none", "no pattern", "no-pattern", "no_pattern", "-"):
        pattern = "solid"
    else:
        pattern = raw_pattern
    material = (str(raw.get("material") or "").strip()) or ""
    item_type = (str(raw.get("item_type") or "").strip()) or "clothing item"
    fit_style = (str(raw.get("fit_style") or "").strip()) or ""

    parts = [color]
    if pattern and pattern != "solid":
        parts.append(pattern)
    if material:
        parts.append(material)
    parts.append(item_type)
    if fit_style:
        parts.append(fit_style)

    subject = " ".join(p for p in parts if p)
    return (
        f"product photo of a {subject}, "
        "isolated on a pure white background, studio lighting, flat lay, high resolution, fashion photography"
    )


@dataclass
class ExtractedGarmentAsset:
    image_bytes: bytes
    description: str
    category: str
    sub_category: Optional[str]
    color_primary: Optional[str]
    pattern: Optional[str]
    material: Optional[str]
    fit_style: Optional[str]
    formality: Optional[str]
    seasonality: Optional[str]


@lru_cache(maxsize=1)
def _gemini_client() -> genai.Client:
    project = os.getenv("GOOGLE_CLOUD_PROJECT")
    if not project:
        raise RuntimeError("Missing GOOGLE_CLOUD_PROJECT for Vertex AI.")
    location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
    return genai.Client(vertexai=True, project=project, location=location)


def _gemini_model_name() -> str:
    return os.getenv("VERTEX_AI_VISION_MODEL") or os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


def _safe_json_parse(raw_text: str) -> dict[str, Any]:
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:].strip()
    return json.loads(text)


def _build_prompt() -> str:
    return (
        "You are a fashion-vision parser. The input is a personal photo; garments may be partially visible.\n"
        "Identify each distinct garment item and return strict JSON only with this exact shape:\n"
        "{\n"
        '  "items": [\n'
        "    {\n"
        '      "item_type": "specific garment type e.g. t-shirt, jeans, blazer, sneakers",\n'
        '      "color": "primary color",\n'
        '      "pattern": "pattern name e.g. solid, striped, plaid, floral, graphic",\n'
        '      "material": "fabric if visible e.g. cotton, denim, silk, leather, or null if not visible",\n'
        '      "fit_style": "fit or style descriptors e.g. oversized, slim fit, cropped, relaxed, fitted, or null",\n'
        '      "category": "top|bottom|dress|outerwear|shoes|accessory",\n'
        '      "sub_category": "short text — use specific names from the lists below",\n'
        '      "formality": "casual|smart_casual|business|formal",\n'
        '      "seasonality": "hot|mild|cold|all_season",\n'
        '      "brand": "brand name if visible on label/logo e.g. Zara, H&M, Urban Revivo, Uniqlo, or null"\n'
        "    }\n"
        "  ]\n"
        "}\n"
        "Sub-category reference lists (use these exact values when applicable):\n"
        "  Tops: t-shirt, shirt, blouse, sweater, cardigan, hoodie, sweatshirt, blazer, vest,\n"
        "        halter_neck, crop_top, tank_top, bodysuit, turtleneck, polo, henley\n"
        "  Bottoms: jeans, trousers, pants, skirt, shorts, leggings, sweatpants, cargo pants,\n"
        "           dress pants, wide-leg pants, culottes\n"
        "  Other: dress, jumpsuit, coat, jacket, parka, cardigan, sneakers, boots, heels,\n"
        "         loafers, sandals, bag, belt, scarf, hat, sunglasses\n"
        "Rules:\n"
        "- Return one entry per garment item you can see.\n"
        "- If uncertain, still choose the closest valid category.\n"
        "- item_type must be a concrete garment name (e.g. crewneck sweater, high-waist trousers).\n"
        "- When no pattern is visible, set pattern to \"solid\" (do not use values like \"none\" or \"no pattern\").\n"
        "- Recognized brands include (non-exhaustive): Zara, H&M, Urban Revivo, Uniqlo, Mango, SHEIN,\n"
        "  Abercrombie & Fitch, Levi's, Ralph Lauren, Tommy Hilfiger, Nike, Adidas, Lululemon.\n"
        "- Output JSON only, no markdown."
    )


def _build_receipt_prompt() -> str:
    return (
        "You are a receipt parser for a wardrobe app.\n"
        "Given a retail receipt screenshot/photo, extract ONLY clothing/accessory line items.\n"
        "Return strict JSON only with this exact shape:\n"
        "{\n"
        '  "items": [\n'
        "    {\n"
        '      "name": "item name",\n'
        '      "brand": "brand or null",\n'
        '      "size": "size or null",\n'
        '      "color": "color or null",\n'
        '      "category": "top|bottom|dress|outerwear|shoes|accessory",\n'
        '      "price": 0.0,\n'
        '      "confidence": 0.0\n'
        "    }\n"
        "  ]\n"
        "}\n"
        "Rules:\n"
        "- Exclude subtotal, total, tax, shipping, discounts, and payment lines.\n"
        "- Include only apparel, shoes, and accessories.\n"
        "- Use null for unknown fields.\n"
        "- confidence must be between 0 and 1.\n"
        "- Output JSON only, no markdown."
    )


def extract_receipt_items_from_image(
    image_bytes: bytes,
    mime_type: str = "image/jpeg",
) -> List[dict[str, Any]]:
    """
    Parse a receipt image using the same Gemini vision client/model as garment extraction.

    This intentionally does not generate any product images; it only extracts structured
    line-item metadata that can be reviewed before adding garments to wardrobe.
    """
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except UnidentifiedImageError as exc:
        is_heic = str(mime_type or "").lower() in ("image/heic", "image/heif")
        if is_heic and not _heic_enabled:
            raise RuntimeError(
                "HEIC images aren't supported in this backend yet. "
                "Install pillow-heif and restart the server, or upload JPG/PNG."
            ) from exc
        raise RuntimeError(
            "Unsupported image format. Please upload a JPG/PNG (HEIC supported if pillow-heif is installed)."
        ) from exc

    width, height = image.size
    logger.info(
        "ReceiptVision start mime=%s size=%dx%d bytes=%d",
        mime_type,
        width,
        height,
        len(image_bytes),
    )

    parsed: dict[str, Any] = {"items": []}
    try:
        client = _gemini_client()
        response = client.models.generate_content(
            model=_gemini_model_name(),
            contents=[
                types.Part.from_text(text=_build_receipt_prompt()),
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            ],
        )
        parsed = _safe_json_parse(response.text or '{"items": []}')
    except Exception as exc:
        logger.exception("ReceiptVision extraction failed")
        raise RuntimeError(
            "Receipt vision parsing failed via Vertex AI. "
            "Check GOOGLE_CLOUD_PROJECT/LOCATION, service-account IAM, and Vertex AI API enablement."
        ) from exc

    items = parsed.get("items") if isinstance(parsed, dict) else []
    if not isinstance(items, list):
        return []

    out: List[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        out.append(
            {
                "name": name,
                "brand": item.get("brand"),
                "size": item.get("size"),
                "color": item.get("color"),
                "category": item.get("category"),
                "price": item.get("price"),
                "confidence": item.get("confidence"),
            }
        )
    logger.info("ReceiptVision complete items=%d", len(out))
    return out


def extract_garments_from_image(image_bytes: bytes, mime_type: str = "image/jpeg") -> List[ExtractedGarmentAsset]:
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except UnidentifiedImageError as exc:
        is_heic = str(mime_type or "").lower() in ("image/heic", "image/heif")
        if is_heic and not _heic_enabled:
            raise RuntimeError(
                "HEIC images aren't supported in this backend yet. "
                "Install pillow-heif and restart the server, or upload JPG/PNG."
            ) from exc
        raise RuntimeError(
            "Unsupported image format. Please upload a JPG/PNG (HEIC supported if pillow-heif is installed)."
        ) from exc
    width, height = image.size
    logger.info("Extractor start mime=%s size=%dx%d bytes=%d", mime_type, width, height, len(image_bytes))

    # Keep an explicit client reference so the underlying httpx client is not
    # finalized while request execution is in-flight.
    parsed: dict[str, Any] = {"items": []}
    try:
        client = _gemini_client()
        response = client.models.generate_content(
            model=_gemini_model_name(),
            contents=[
                types.Part.from_text(text=_build_prompt()),
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            ],
        )
        parsed = _safe_json_parse(response.text or '{"items": []}')
        logger.info("Gemini response parsed model=%s", _gemini_model_name())
    except Exception as exc:
        logger.exception("Gemini extraction failed")
        raise RuntimeError(
            "Gemini extraction failed via Vertex AI. "
            "Check that GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION are set, "
            "the Cloud Run service account has the 'roles/aiplatform.user' IAM role, "
            "and the Vertex AI API is enabled on the project."
        ) from exc

    items = parsed.get("items") if isinstance(parsed, dict) else []
    if not isinstance(items, list):
        items = []
    logger.info("Extractor candidate items=%d", len(items))

    try:
        max_garments = max(1, int(os.getenv("VISION_MAX_GARMENT_IMAGES", "6")))
    except ValueError:
        max_garments = 6
    if len(items) > max_garments:
        logger.warning("Extractor capping garment images %d -> %d (VISION_MAX_GARMENT_IMAGES)", len(items), max_garments)
        items = items[:max_garments]

    spacing = float(os.getenv("HF_IMAGE_GEN_SPACING_SEC", "1.5"))

    assets: List[ExtractedGarmentAsset] = []
    for idx, raw_item in enumerate(items):
        if not isinstance(raw_item, dict):
            continue
        item_type = str(raw_item.get("item_type") or "").strip()
        if not item_type:
            continue

        if idx > 0 and spacing > 0:
            time.sleep(spacing)

        product_prompt = _product_prompt_for_item(raw_item)
        image_out = generate_garment_image(product_prompt)

        def _str_or_none(key: str) -> Optional[str]:
            v = raw_item.get(key)
            return str(v).strip() if v else None

        raw_pattern = _str_or_none("pattern")
        norm_pattern = raw_pattern.strip().lower() if raw_pattern else ""
        stored_pattern: Optional[str]
        if norm_pattern in ("", "solid", "none", "no pattern", "no-pattern", "no_pattern", "-"):
            stored_pattern = None
        else:
            stored_pattern = raw_pattern

        assets.append(
            ExtractedGarmentAsset(
                image_bytes=image_out,
                description=product_prompt,
                category=str(raw_item.get("category") or "top"),
                sub_category=_str_or_none("sub_category"),
                color_primary=_str_or_none("color") or _str_or_none("color_primary"),
                pattern=stored_pattern,
                material=_str_or_none("material"),
                fit_style=_str_or_none("fit_style"),
                formality=_str_or_none("formality"),
                seasonality=_str_or_none("seasonality"),
            )
        )

    logger.info("Extractor complete assets=%d", len(assets))
    return assets
