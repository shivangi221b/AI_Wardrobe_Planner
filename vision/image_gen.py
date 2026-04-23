from __future__ import annotations

import io
import logging
import os
import time
from functools import lru_cache
from pathlib import Path

import httpx
from google import genai
from google.genai import types as genai_types
from huggingface_hub import InferenceClient
from PIL import Image

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None

# Same repo-root .env as backend/main.py — needed for `python -c "from vision.image_gen import …"`.
if load_dotenv is not None:
    load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)

logger = logging.getLogger(__name__)

HF_FLUX_MODEL = "black-forest-labs/FLUX.1-schnell"
# GA model: https://cloud.google.com/vertex-ai/generative-ai/docs/models/imagen/4-0-generate
DEFAULT_IMAGEN_MODEL = "imagen-4.0-fast-generate-001"


def _max_image_prompt_chars() -> int:
    """
    Maximum characters sent to text-to-image APIs (Imagen + HF FLUX).

    Long avatar prompts include a detailed Gemini face description; default allows
    up to 10,000 characters. Override with ``IMAGE_GEN_MAX_PROMPT_CHARS`` (clamped 256–10000).
    """
    try:
        n = int(os.getenv("IMAGE_GEN_MAX_PROMPT_CHARS", "10000"))
        return max(256, min(10_000, n))
    except ValueError:
        return 10_000


def _image_gen_provider() -> str:
    return os.getenv("IMAGE_GEN_PROVIDER", "hf").strip().lower()


def _avatar_image_gen_provider() -> str:
    """
    Provider for user avatar portraits.

    FLUX.1-schnell (``IMAGE_GEN_PROVIDER=hf``) is fast but often ignores long
    prompts and falls back to generic “stock” faces. When ``GOOGLE_CLOUD_PROJECT``
    is set, we default avatars to **Vertex Imagen** unless overridden.

    Env:

    - ``AVATAR_IMAGE_GEN_PROVIDER`` — ``vertex`` | ``hf`` | ``auto`` (default).
      ``auto`` uses Vertex if ``GOOGLE_CLOUD_PROJECT`` is non-empty, else the
      same provider as ``IMAGE_GEN_PROVIDER``.
    """
    raw = os.getenv("AVATAR_IMAGE_GEN_PROVIDER", "auto").strip().lower()
    if raw in ("hf", "flux"):
        return "hf"
    if raw in ("vertex", "imagen"):
        return "vertex"
    if raw == "auto":
        if (os.getenv("GOOGLE_CLOUD_PROJECT") or "").strip():
            return "vertex"
        return _image_gen_provider()
    return _image_gen_provider()


def _target_size() -> int:
    try:
        return max(256, min(1024, int(os.getenv("GARMENT_ASSET_SIZE", "512"))))
    except Exception:
        return 512


@lru_cache(maxsize=1)
def _vertex_genai_client() -> genai.Client:
    """Vertex-backed client for Imagen (same auth as Gemini in vision/extractor.py)."""
    project = (os.getenv("GOOGLE_CLOUD_PROJECT") or "").strip()
    if not project:
        raise RuntimeError(
            "Missing GOOGLE_CLOUD_PROJECT for Vertex Imagen. "
            "Set it in the repo-root .env (local) or Cloud Run env (prod)."
        )
    location = (os.getenv("GOOGLE_CLOUD_LOCATION") or "us-central1").strip()
    return genai.Client(vertexai=True, project=project, location=location)


def _imagen_model_id() -> str:
    return (os.getenv("IMAGEN_MODEL") or DEFAULT_IMAGEN_MODEL).strip()


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


def _http_status_from_exception(exc: BaseException) -> int | None:
    err: BaseException | None = exc
    while err is not None:
        if isinstance(err, httpx.HTTPStatusError):
            return err.response.status_code
        err = err.__cause__
    return None


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
    cap = _max_image_prompt_chars()
    prompt_text = prompt[:cap]
    logger.info(
        "ImageGen(HF FLUX) start model=%s prompt_len=%d cap=%d size=%d",
        HF_FLUX_MODEL,
        len(prompt_text),
        cap,
        size,
    )

    max_retries = max(1, int(os.getenv("HF_IMAGE_GEN_MAX_RETRIES", "5")))
    backoff = float(os.getenv("HF_IMAGE_GEN_BACKOFF_SEC", "2.0"))

    image = None
    last_exc: BaseException | None = None
    for attempt in range(max_retries):
        try:
            image = client.text_to_image(
                prompt_text,
                model=HF_FLUX_MODEL,
                guidance_scale=0,
                num_inference_steps=4,
            )
            break
        except Exception as exc:
            last_exc = exc
            code = _http_status_from_exception(exc)
            if code in (429, 503) and attempt < max_retries - 1:
                wait = backoff * (2**attempt)
                logger.warning(
                    "ImageGen(HF) HTTP %s attempt %d/%d — sleeping %.1fs then retry",
                    code,
                    attempt + 1,
                    max_retries,
                    wait,
                )
                time.sleep(wait)
                continue

            logger.exception("ImageGen(HF) request failed")
            detail = "Image generation failed (Hugging Face). Check HF_API_TOKEN/quota and retry."
            err: BaseException | None = exc
            while err is not None:
                if isinstance(err, httpx.HTTPStatusError) and err.response.status_code == 429:
                    detail = (
                        "Hugging Face returned HTTP 429 after retries (rate limit). "
                        "Cloud Run uses shared egress IPs that HF often throttles; "
                        "ensure HF_API_TOKEN is set and HUGGINGFACE_HUB_TOKEN is populated for Hub API calls. "
                        "Try again later, set VISION_MAX_GARMENT_IMAGES lower, increase HF_IMAGE_GEN_SPACING_SEC, "
                        "or use Hugging Face paid / higher inference limits."
                    )
                    break
                err = err.__cause__
            raise RuntimeError(detail) from exc

    if image is None:
        raise RuntimeError("Image generation failed (Hugging Face).") from last_exc

    raw = io.BytesIO()
    image.save(raw, format="PNG")
    out_bytes = _to_square_jpeg(raw.getvalue(), size=size)
    logger.info("ImageGen(HF FLUX) complete bytes=%d", len(out_bytes))
    return out_bytes


def _is_transient_vertex_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    if "429" in msg or "503" in msg or "resource exhausted" in msg or "unavailable" in msg:
        return True
    return False


def _generate_with_vertex_imagen(prompt: str, size: int) -> bytes:
    """Generate using Imagen on Vertex AI (e.g. Imagen 4 Fast). Bills per image; see Vertex AI pricing."""
    client = _vertex_genai_client()
    model = _imagen_model_id()
    cap = _max_image_prompt_chars()
    prompt_text = prompt[:cap]
    logger.info(
        "ImageGen(Vertex Imagen) start model=%s prompt_len=%d cap=%d target_jpeg=%d",
        model,
        len(prompt_text),
        cap,
        size,
    )

    max_retries = max(1, int(os.getenv("IMAGEN_GEN_MAX_RETRIES", os.getenv("HF_IMAGE_GEN_MAX_RETRIES", "5"))))
    backoff = float(os.getenv("IMAGEN_GEN_BACKOFF_SEC", os.getenv("HF_IMAGE_GEN_BACKOFF_SEC", "2.0")))

    config = genai_types.GenerateImagesConfig(
        number_of_images=1,
        aspect_ratio="1:1",
        output_mime_type="image/png",
        add_watermark=True,
    )

    response = None
    last_exc: Exception | None = None
    for attempt in range(max_retries):
        try:
            response = client.models.generate_images(
                model=model,
                prompt=prompt_text,
                config=config,
            )
            break
        except Exception as exc:
            last_exc = exc
            if _is_transient_vertex_error(exc) and attempt < max_retries - 1:
                wait = backoff * (2**attempt)
                logger.warning(
                    "ImageGen(Vertex Imagen) transient error attempt %d/%d — sleeping %.1fs: %s",
                    attempt + 1,
                    max_retries,
                    wait,
                    exc,
                )
                time.sleep(wait)
                continue
            logger.exception("ImageGen(Vertex Imagen) request failed")
            raise RuntimeError(
                "Image generation failed (Vertex Imagen). "
                "Check GOOGLE_CLOUD_PROJECT/location, Vertex AI API + billing, and IAM on the runtime service account."
            ) from exc

    if response is None:
        raise RuntimeError("Image generation failed (Vertex Imagen).") from last_exc

    if not response.generated_images:
        raise RuntimeError(
            "Vertex Imagen returned no images (empty response). "
            "If this persists, the prompt may have been filtered; try a simpler product description."
        )

    first = response.generated_images[0]
    if first.rai_filtered_reason:
        logger.warning("Imagen RAI filter: %s", first.rai_filtered_reason)
    img = first.image
    if img is None or not img.image_bytes:
        raise RuntimeError(
            "Vertex Imagen returned no image bytes. "
            "The output may have been safety-filtered; check logs for rai_filtered_reason."
        )

    out_bytes = _to_square_jpeg(img.image_bytes, size=size)
    logger.info("ImageGen(Vertex Imagen) complete bytes=%d", len(out_bytes))
    return out_bytes


def generate_garment_image(prompt: str) -> bytes:
    """
    Generate a clean, product-style garment image from a text prompt.

    Providers (``IMAGE_GEN_PROVIDER``):

    - ``hf`` — Hugging Face FLUX.1-schnell (requires ``HF_API_TOKEN``).
    - ``vertex`` — Vertex AI Imagen (default model ``imagen-4.0-fast-generate-001``; requires
      ``GOOGLE_CLOUD_PROJECT``, ADC or Cloud Run service account, Vertex AI API enabled).

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

    if provider in ("vertex", "imagen"):
        return _generate_with_vertex_imagen(text, size=size)

    raise RuntimeError(
        f"Unknown IMAGE_GEN_PROVIDER={provider}. "
        "Use hf (Hugging Face + HF_API_TOKEN) or vertex (Vertex Imagen + GOOGLE_CLOUD_PROJECT)."
    )


def generate_avatar_portrait_image(prompt: str) -> bytes:
    """
    Generate a stylised portrait for the avatar feature.

    Uses :func:`_avatar_image_gen_provider` so local dev can keep
    ``IMAGE_GEN_PROVIDER=hf`` for garments while avatars use Vertex Imagen when
    a GCP project is configured.
    """
    text = (prompt or "").strip()
    if not text:
        raise ValueError("Missing prompt for avatar image generation.")

    size = _target_size()
    provider = _avatar_image_gen_provider()
    logger.info(
        "ImageGen(avatar) provider=%s size=%d prompt_len=%d",
        provider,
        size,
        len(text),
    )

    if provider == "hf":
        return _generate_with_hf_flux(text, size=size)

    if provider in ("vertex", "imagen"):
        return _generate_with_vertex_imagen(text, size=size)

    raise RuntimeError(
        f"Unknown AVATAR_IMAGE_GEN_PROVIDER / provider resolution={provider}. "
        "Use hf or vertex."
    )
