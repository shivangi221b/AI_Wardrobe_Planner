from __future__ import annotations

import io
import logging
import os
from functools import lru_cache

import httpx
from huggingface_hub import InferenceClient
from PIL import Image

logger = logging.getLogger(__name__)

HF_FLUX_MODEL = "black-forest-labs/FLUX.1-schnell"


def _image_gen_provider() -> str:
    return os.getenv("IMAGE_GEN_PROVIDER", "hf").strip().lower()


def _target_size() -> int:
    try:
        return max(256, min(1024, int(os.getenv("GARMENT_ASSET_SIZE", "512"))))
    except Exception:
        return 512


@lru_cache(maxsize=1)
def _hf_inference_client() -> InferenceClient:
    token = (os.getenv("HF_API_TOKEN") or os.getenv("HUGGINGFACE_HUB_TOKEN") or "").strip()
    if not token:
        raise RuntimeError(
            "Missing HF_API_TOKEN for image generation. "
            "Set HF_API_TOKEN (or HUGGINGFACE_HUB_TOKEN) in the backend env. "
            "Create a token at https://huggingface.co/settings/tokens"
        )
    # Hub metadata calls (e.g. GET /api/models/...) use HUGGINGFACE_HUB_TOKEN from the
    # environment; without it, Cloud Run's shared egress IP is rate-limited as anonymous.
    os.environ.setdefault("HUGGINGFACE_HUB_TOKEN", token)
    # Use Inference Providers routing so we don't hardcode router URLs.
    return InferenceClient(provider="hf-inference", api_key=token)


def _to_square_jpeg(image_bytes: bytes, size: int) -> bytes:
    img = Image.open(io.BytesIO(image_bytes))
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")

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


def _generate_with_hf_flux(prompt: str, size: int) -> bytes:
    """Generate image using Hugging Face Inference Providers with FLUX.1-schnell."""
    client = _hf_inference_client()

    # FLUX.1-schnell: timestep-distilled, use guidance_scale=0 and a few steps.
    prompt_text = prompt[:1000]
    logger.info("ImageGen(HF FLUX) start model=%s prompt_len=%d size=%d", HF_FLUX_MODEL, len(prompt_text), size)

    try:
        image = client.text_to_image(
            prompt_text,
            model=HF_FLUX_MODEL,
            guidance_scale=0,
            num_inference_steps=4,
        )
    except Exception as exc:
        logger.exception("ImageGen(HF) request failed")
        detail = "Image generation failed (Hugging Face). Check HF_API_TOKEN/quota and retry."
        err = exc
        while err is not None:
            if isinstance(err, httpx.HTTPStatusError) and err.response.status_code == 429:
                detail = (
                    "Hugging Face returned HTTP 429 (rate limit). "
                    "Cloud Run uses shared egress IPs that HF often throttles; "
                    "ensure HF_API_TOKEN is set (and redeploy so HUGGINGFACE_HUB_TOKEN is populated for Hub API calls). "
                    "If it persists, wait and retry, reduce garments per image, or use HF billing / higher limits."
                )
                break
            err = err.__cause__
        raise RuntimeError(detail) from exc

    raw = io.BytesIO()
    image.save(raw, format="PNG")
    out_bytes = _to_square_jpeg(raw.getvalue(), size=size)
    logger.info("ImageGen(HF FLUX) complete bytes=%d", len(out_bytes))
    return out_bytes


def generate_garment_image(prompt: str) -> bytes:
    """
    Generate a clean, product-style garment image from a text prompt.

    Uses Hugging Face Inference API with FLUX.1-schnell by default (free tier available).
    The prompt should already be a full product-photo description (e.g. from the vision extractor).

    Returns JPEG bytes (square, white background) ready for storage upload.
    """
    text = (prompt or "").strip()
    if not text:
        raise ValueError("Missing prompt for image generation.")

    size = _target_size()
    provider = _image_gen_provider()

    logger.info("ImageGen start provider=%s size=%d prompt_len=%d", provider, size, len(text))

    if provider == "hf":
        return _generate_with_hf_flux(text, size=size)

    raise RuntimeError(
        f"Unknown IMAGE_GEN_PROVIDER={provider}. "
        "Set IMAGE_GEN_PROVIDER=hf and HF_API_TOKEN for FLUX.1-schnell (recommended)."
    )
