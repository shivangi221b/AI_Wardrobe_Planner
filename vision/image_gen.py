from __future__ import annotations

import io
import logging
import os
from functools import lru_cache

import httpx
from google import genai
from google.genai import types
from PIL import Image

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _gemini_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("Missing GEMINI_API_KEY.")
    return genai.Client(api_key=api_key)


def _image_gen_model_name() -> str:
    # Imagen 3 model IDs evolve; keep it configurable.
    return os.getenv("IMAGE_GEN_MODEL", "imagen-3.0-generate-002")

def _image_gen_provider() -> str:
    return os.getenv("IMAGE_GEN_PROVIDER", "gemini").strip().lower()


def _target_size() -> int:
    try:
        return max(256, min(1024, int(os.getenv("GARMENT_ASSET_SIZE", "512"))))
    except Exception:
        return 512


def _prompt_for(description: str) -> str:
    # Intentionally biases toward catalog-style assets like your references.
    # We avoid logos/branding to reduce weird artifacts; brand is still stored as metadata separately.
    return (
        "Create a high-quality catalog product photo of a single clothing item.\n"
        f"Item: {description}\n"
        "Constraints:\n"
        "- White background, studio lighting, centered.\n"
        "- No people, no mannequins, no hands, no hangers.\n"
        "- Show the entire item (not cropped), correct proportions.\n"
        "- Photorealistic, sharp focus.\n"
        "- No text, no watermark, no logo.\n"
    )


def _to_square_jpeg(image_bytes: bytes, size: int) -> bytes:
    img = Image.open(io.BytesIO(image_bytes))
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")

    # Thumbnail while preserving aspect ratio, then center on white square.
    img.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (size, size), "white")

    if img.mode == "RGBA":
        left = (size - img.width) // 2
        top = (size - img.height) // 2
        canvas.paste(img, (left, top), img)
    else:
        left = (size - img.width) // 2
        top = (size - img.height) // 2
        canvas.paste(img.convert("RGB"), (left, top))

    out = io.BytesIO()
    canvas.save(out, format="JPEG", quality=95)
    return out.getvalue()

def _generate_with_gemini(prompt: str, size: int) -> bytes:
    model = _image_gen_model_name()
    logger.info("ImageGen(Gemini) start model=%s size=%d", model, size)

    try:
        client = _gemini_client()
        resp = client.models.generate_images(
            model=model,
            prompt=prompt,
            config=types.GenerateImagesConfig(number_of_images=1),
        )
    except Exception as exc:
        message = str(exc)
        logger.exception("ImageGen(Gemini) request failed model=%s", model)
        if "API_KEY_SERVICE_BLOCKED" in message or "PredictionService.Predict" in message:
            raise RuntimeError(
                "Image generation is blocked for this Google API key (PredictionService.Predict). "
                "Fix: enable Gemini API/Imagen access for this key, or switch providers by setting "
                "IMAGE_GEN_PROVIDER=fal and FAL_KEY in the backend env."
            ) from exc
        if "NOT_FOUND" in message and "is not found" in message:
            raise RuntimeError(
                f"Image generation model '{model}' is not available for this key. "
                "Set IMAGE_GEN_MODEL to a supported Imagen model for your account, "
                "or switch providers by setting IMAGE_GEN_PROVIDER=fal and FAL_KEY."
            ) from exc
        raise RuntimeError("Image generation failed. Check API key/quota and retry.") from exc

    generated = (resp.generated_images or []) if resp else []
    if not generated or not generated[0] or not getattr(generated[0], "image", None):
        raise RuntimeError("Image generation failed: no image returned by provider.")

    raw_bytes = getattr(generated[0].image, "image_bytes", None)
    if not raw_bytes:
        raise RuntimeError("Image generation failed: provider returned empty image bytes.")

    out_bytes = _to_square_jpeg(raw_bytes, size=size)
    logger.info("ImageGen(Gemini) complete bytes=%d", len(out_bytes))
    return out_bytes


async def _generate_with_fal_async(prompt: str, size: int) -> bytes:
    fal_key = (os.getenv("FAL_KEY") or "").strip()
    if not fal_key:
        raise RuntimeError("Missing FAL_KEY for IMAGE_GEN_PROVIDER=fal.")

    endpoint = os.getenv("FAL_FLUX_ENDPOINT", "https://fal.run/fal-ai/flux-pro/v1.1").strip()
    image_size = os.getenv("FAL_IMAGE_SIZE", "square_hd").strip()  # fal preset sizes

    logger.info("ImageGen(FAL) start endpoint=%s preset=%s target=%d", endpoint, image_size, size)

    payload = {
        "prompt": prompt,
        "num_images": 1,
        "image_size": image_size,
        "output_format": "jpeg",
    }
    headers = {"Authorization": f"Key {fal_key}", "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(endpoint, json=payload, headers=headers)
        if resp.status_code >= 400:
            logger.error("ImageGen(FAL) request failed status=%d body=%s", resp.status_code, resp.text[:5000])
            raise RuntimeError("Image generation failed (fal.ai). Check FAL_KEY/quota and retry.")
        data = resp.json()

        images = data.get("images") if isinstance(data, dict) else None
        if not isinstance(images, list) or not images:
            raise RuntimeError("Image generation failed (fal.ai): no images in response.")

        url = images[0].get("url") if isinstance(images[0], dict) else None
        if not isinstance(url, str) or not url.strip():
            raise RuntimeError("Image generation failed (fal.ai): missing image url.")

        img_resp = await client.get(url.strip())
        if img_resp.status_code >= 400 or not img_resp.content:
            raise RuntimeError("Image generation failed (fal.ai): could not download generated image.")

    out_bytes = _to_square_jpeg(img_resp.content, size=size)
    logger.info("ImageGen(FAL) complete bytes=%d", len(out_bytes))
    return out_bytes


def generate_garment_image(description: str) -> bytes:
    """
    Generate a clean, complete product-style garment asset from text.

    Returns JPEG bytes (square, white background) ready for storage upload.
    """
    desc = (description or "").strip()
    if not desc:
        raise ValueError("Missing garment description for image generation.")

    size = _target_size()
    prompt = _prompt_for(desc)
    provider = _image_gen_provider()

    logger.info("ImageGen start provider=%s size=%d desc_len=%d", provider, size, len(desc))
    if provider == "fal":
        # Keep sync API surface for caller; run a small async loop internally.
        import asyncio

        return asyncio.run(_generate_with_fal_async(prompt, size=size))

    return _generate_with_gemini(prompt, size=size)

