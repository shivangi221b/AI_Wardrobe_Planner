from __future__ import annotations

import io
import json
import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, List, Optional

from google import genai
from google.genai import types
from PIL import Image

from .image_gen import generate_garment_image

logger = logging.getLogger(__name__)


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
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("Missing GEMINI_API_KEY.")
    return genai.Client(api_key=api_key)


def _gemini_model_name() -> str:
    return os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


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
        '      "description": "rich natural-language description of the garment suitable for generating a product photo",\n'
        '      "category": "top|bottom|dress|outerwear|shoes|accessory",\n'
        '      "item_type": "short text for the specific garment type, e.g. crewneck sweater, straight-leg jeans",\n'
        '      "sub_category": "optional shorter label for item_type",\n'
        '      "color_primary": "short color",\n'
        '      "pattern": "e.g. solid, striped, plaid, floral, graphic, logo, colorblock, etc.",\n'
        '      "material": "e.g. cotton, linen, wool, denim, leather, synthetic, knit, etc. If unsure, best guess.",\n'
        '      "fit_style": "short fit/style descriptors, e.g. oversized, relaxed, slim fit, cropped, wide-leg",\n'
        '      "formality": "casual|smart_casual|business|formal",\n'
        '      "seasonality": "hot|mild|cold|all_season"\n'
        "    }\n"
        "  ]\n"
        "}\n"
        "Rules:\n"
        "- Return one entry per garment item you can see.\n"
        "- If uncertain, still choose the closest valid category.\n"
        "- The description must describe the full garment, even if only partially visible (infer likely full shape).\n"
        "- \"item_type\" should be something a shopper would recognize for this garment (e.g. \"oxford shirt\", \"straight-leg jeans\").\n"
        "- If you truly cannot determine pattern/material/fit_style, still return a best-effort guess instead of null.\n"
        "- Output JSON only, no markdown."
    )


def extract_garments_from_image(image_bytes: bytes, mime_type: str = "image/jpeg") -> List[ExtractedGarmentAsset]:
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
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
        raise RuntimeError("Gemini extraction failed. Check API key/quota and retry.") from exc

    items = parsed.get("items") if isinstance(parsed, dict) else []
    if not isinstance(items, list):
        items = []
    logger.info("Extractor candidate items=%d", len(items))

    assets: List[ExtractedGarmentAsset] = []
    for raw_item in items:
        if not isinstance(raw_item, dict):
            continue
        description = str(raw_item.get("description") or "").strip()
        if not description:
            continue

        # Pull structured metadata for prompt construction.
        item_type = str(
            raw_item.get("item_type")
            or raw_item.get("sub_category")
            or raw_item.get("category")
            or "garment"
        ).strip()
        color_primary = (str(raw_item.get("color_primary")) if raw_item.get("color_primary") else None)
        pattern = (str(raw_item.get("pattern")) if raw_item.get("pattern") else None)
        material = (str(raw_item.get("material")) if raw_item.get("material") else None)
        fit_style = (str(raw_item.get("fit_style")) if raw_item.get("fit_style") else None)

        # Generate a polished catalog-style asset from structured metadata.
        image_out = generate_garment_image(
            item_type=item_type,
            color=color_primary,
            pattern=pattern,
            material=material,
            fit_style=fit_style,
        )
        assets.append(
            ExtractedGarmentAsset(
                image_bytes=image_out,
                description=description,
                category=str(raw_item.get("category") or "top"),
                sub_category=(str(raw_item.get("sub_category")) if raw_item.get("sub_category") else None),
                color_primary=color_primary,
                pattern=pattern,
                material=material,
                fit_style=fit_style,
                formality=(str(raw_item.get("formality")) if raw_item.get("formality") else None),
                seasonality=(str(raw_item.get("seasonality")) if raw_item.get("seasonality") else None),
            )
        )

    logger.info("Extractor complete assets=%d", len(assets))
    return assets
