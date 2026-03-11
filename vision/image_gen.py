from __future__ import annotations

import io
import logging
import os

import httpx
from PIL import Image

logger = logging.getLogger(__name__)


def _target_size() -> int:
    try:
        return max(256, min(1024, int(os.getenv("GARMENT_ASSET_SIZE", "512"))))
    except Exception:
        return 512


def _hf_model_id() -> str:
    """
    Default to FLUX.1-schnell hosted on Hugging Face.
    """
    return os.getenv("HF_FLUX_MODEL_ID", "black-forest-labs/FLUX.1-schnell").strip()


def _hf_api_url() -> str:
    base = os.getenv("HF_INFERENCE_BASE_URL", "https://api-inference.huggingface.co").rstrip("/")
    return f"{base}/models/{_hf_model_id()}"


def _hf_token() -> str:
    token = (os.getenv("HF_API_TOKEN") or "").strip()
    if not token:
        raise RuntimeError("Missing HF_API_TOKEN for Hugging Face Inference API.")
    return token


def _build_flux_prompt(
    item_type: str,
    color: str | None = None,
    pattern: str | None = None,
    material: str | None = None,
    fit_style: str | None = None,
) -> str:
    """
    Construct a FLUX-friendly product photo prompt from structured garment metadata.
    """
    parts: list[str] = []
    if color:
        parts.append(color)
    if pattern:
        parts.append(pattern)
    if material:
        parts.append(material)

    core_subject = " ".join(p for p in parts if p) + f" {item_type}".strip()
    core_subject = core_subject.strip()
    if not core_subject:
        core_subject = item_type or "clothing item"

    fit_clause = f", {fit_style}" if fit_style else ""

    return (
        f"product photo of a {core_subject}{fit_clause}, "
        "isolated on a pure white background, studio lighting, flat lay, high resolution, fashion photography, "
        "no people, no mannequins, no text, no watermark, full garment in frame"
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


def _generate_with_hf(prompt: str, size: int) -> bytes:
    """
    Call Hugging Face Inference API with FLUX.1-schnell and return a square JPEG.
    """
    url = _hf_api_url()
    headers = {
        "Authorization": f"Bearer {_hf_token()}",
        "Accept": "image/png",
        "Content-Type": "application/json",
    }
    payload = {
        "inputs": prompt,
        # Basic, fast settings; callers can tune via env overrides later if needed.
        "parameters": {
            "guidance_scale": 0.0,
            "num_inference_steps": 4,
        },
    }

    logger.info("ImageGen(HF) start model=%s size=%d", _hf_model_id(), size)
    try:
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(url, headers=headers, json=payload)
    except Exception as exc:
        logger.exception("ImageGen(HF) request error")
        raise RuntimeError("Image generation failed (Hugging Face). Check network and retry.") from exc

    if resp.status_code == 503:
        # Model is still loading on the HF side; surface a clear message.
        logger.error("ImageGen(HF) model loading status=503 body=%s", resp.text[:2000])
        raise RuntimeError(
            "Image generation model is still loading on Hugging Face. Please wait a moment and retry."
        )

    if resp.status_code >= 400:
        logger.error(
            "ImageGen(HF) failed status=%d body=%s", resp.status_code, resp.text[:2000]
        )
        raise RuntimeError(
            "Image generation failed (Hugging Face). Check HF_API_TOKEN, model access, or try again later."
        )

    if not resp.content:
        raise RuntimeError("Image generation failed (Hugging Face): empty image content.")

    out_bytes = _to_square_jpeg(resp.content, size=size)
    logger.info("ImageGen(HF) complete bytes=%d", len(out_bytes))
    return out_bytes


def generate_garment_image(
    *,
    item_type: str,
    color: str | None = None,
    pattern: str | None = None,
    material: str | None = None,
    fit_style: str | None = None,
) -> bytes:
    """
    Generate a clean, complete product-style garment asset from structured metadata.

    Returns JPEG bytes (square, white background) ready for storage upload.
    """
    item_type_clean = (item_type or "").strip()
    if not item_type_clean:
        raise ValueError("Missing garment item_type for image generation.")

    size = _target_size()
    prompt = _build_flux_prompt(
        item_type=item_type_clean,
        color=(color or "").strip() or None,
        pattern=(pattern or "").strip() or None,
        material=(material or "").strip() or None,
        fit_style=(fit_style or "").strip() or None,
    )

    logger.info("ImageGen start provider=hf-flux size=%d prompt_len=%d", size, len(prompt))
    return _generate_with_hf(prompt, size=size)


