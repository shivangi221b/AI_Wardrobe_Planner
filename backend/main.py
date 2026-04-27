from __future__ import annotations

import logging
import os
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from uuid import uuid4

from dotenv import load_dotenv

# Load repo-root .env so uvicorn works without `export $(grep .env | xargs)` (breaks if KEY = value has spaces).
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl
from starlette.concurrency import run_in_threadpool

from vision.extractor import ExtractedGarmentAsset, extract_garments_from_image

from .db import delete_garment, get_measurements, insert_garment, set_garment_hidden, upsert_measurements
from .models import (
    BodyMeasurements,
    GarmentCategory,
    GarmentFormality,
    GarmentGender,
    GarmentItem,
    GarmentSeasonality,
    build_garment_tags,
    MediaIngestionJob,
    MediaIngestionStatus,
    MediaType,
    WeekEvent,
)
from .routers import analytics_router, auth_router, recommendations, weather_router, calendar_router, profile_router, avatar_router, shop_router
from .routers.analytics_router import public_metrics_router
from .storage import get_wardrobe, get_week_events as _storage_get_week_events, store_week_events

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Wardrobe Planner API", version="0.1.0")

# Origins are driven by the ALLOWED_ORIGINS environment variable so the same
# binary can serve local dev and staging without code changes.
# Set ALLOWED_ORIGINS to a comma-separated list of trusted origins in production.
# Example: ALLOWED_ORIGINS="https://app.misfitai.com,https://staging.misfitai.com"
_raw_origins = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:8081,http://127.0.0.1:8081,http://[::1]:8081,http://localhost:3000,http://localhost:19006,http://127.0.0.1:19006",
)
_allowed_origins: list[str] = [o.strip() for o in _raw_origins.split(",") if o.strip()]

# Optional regex for origins that cannot be enumerated statically, e.g. Firebase
# Hosting preview channels whose subdomain contains a random hash.
# Example (dev Cloud Run): CORS_ORIGIN_REGEX=https://.*\.web\.app
# Starlette raises ValueError if allow_origins=["*"] AND allow_credentials=True,
# so use this regex pattern instead of ALLOWED_ORIGINS=* for open-CORS dev envs.
_cors_origin_regex: str | None = os.getenv("CORS_ORIGIN_REGEX", "").strip() or None

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=_cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(recommendations.router)
app.include_router(auth_router.router)
app.include_router(weather_router.router)
app.include_router(calendar_router.router)
app.include_router(analytics_router.router)
app.include_router(public_metrics_router)
app.include_router(profile_router.router)
app.include_router(avatar_router.router)
app.include_router(shop_router.router)

_local_assets_dir = Path(os.getenv("LOCAL_GARMENTS_DIR", "outputs/local_garments"))
_local_assets_dir.mkdir(parents=True, exist_ok=True)
app.mount(
    "/assets/local-garments",
    StaticFiles(directory=str(_local_assets_dir)),
    name="local-garments",
)

_local_avatars_dir = Path(os.getenv("LOCAL_AVATARS_DIR", "outputs/local_avatars"))
_local_avatars_dir.mkdir(parents=True, exist_ok=True)
app.mount(
    "/assets/local-avatars",
    StaticFiles(directory=str(_local_avatars_dir)),
    name="local-avatars",
)


class MediaIngestionRequest(BaseModel):
    user_id: str
    media_type: MediaType
    source_uri: str


class MediaIngestionResponse(BaseModel):
    job_id: str
    status: MediaIngestionStatus


class AddGarmentRequest(BaseModel):
    name: str
    category: GarmentCategory
    color: Optional[str] = None
    formality: Optional[GarmentFormality] = None
    seasonality: Optional[GarmentSeasonality] = None
    primary_image_url: HttpUrl
    gender: Optional[GarmentGender] = None
    brand: Optional[str] = None


class SearchGarmentRequest(BaseModel):
    query: str
    limit: int = 8
    color: Optional[str] = None
    material: Optional[str] = None
    kind: Optional[str] = None
    gender: Optional[str] = None


class SearchGarmentResult(BaseModel):
    image_url: str
    title: Optional[str] = None
    source_url: Optional[str] = None


class VisionPreviewItem(BaseModel):
    image_url: HttpUrl
    category: GarmentCategory
    sub_category: Optional[str] = None
    color_primary: Optional[str] = None
    pattern: Optional[str] = None
    material: Optional[str] = None
    fit_notes: Optional[str] = None
    formality: Optional[GarmentFormality] = None
    seasonality: Optional[GarmentSeasonality] = None


class VisionCommitRequest(BaseModel):
    items: List[VisionPreviewItem]


def _is_trusted_image_url(url: str) -> bool:
    url = (url or "").strip()
    if not url:
        return False
    allowed_prefixes: list[str] = []
    local_base = os.getenv("LOCAL_ASSET_BASE_URL")
    if local_base:
        allowed_prefixes.append(local_base.rstrip("/"))
    supabase_url = os.getenv("SUPABASE_URL")
    if supabase_url:
        allowed_prefixes.append(supabase_url.rstrip("/"))
    if not allowed_prefixes:
        # In local/dev with no configured bases, accept anything to avoid false positives.
        return True
    return any(url.startswith(prefix) for prefix in allowed_prefixes)


def _safe_category(value: str) -> GarmentCategory:
    try:
        return GarmentCategory(value)
    except Exception:
        return GarmentCategory.TOP


def _safe_formality(value: Optional[str]) -> Optional[GarmentFormality]:
    if not value:
        return None
    try:
        return GarmentFormality(value)
    except Exception:
        return None


def _safe_seasonality(value: Optional[str]) -> Optional[GarmentSeasonality]:
    if not value:
        return None
    try:
        return GarmentSeasonality(value)
    except Exception:
        return None


# Keep ingestion jobs in-memory for now; wardrobe lives in Supabase.
_jobs: dict[str, MediaIngestionJob] = {}


@app.post("/media-ingestion", response_model=MediaIngestionResponse)
def create_media_ingestion_job(request: MediaIngestionRequest) -> MediaIngestionResponse:
    job_id = str(uuid4())
    now = datetime.utcnow()

    job = MediaIngestionJob(
        id=job_id,
        user_id=request.user_id,
        media_type=request.media_type,
        source_uri=request.source_uri,
        status=MediaIngestionStatus.PENDING,
        progress=0.0,
        created_at=now,
        updated_at=now,
    )
    _jobs[job_id] = job

    # A separate worker service will pick up this job, update its status, and
    # populate the user's wardrobe via storage.add_garments(user_id, items).

    return MediaIngestionResponse(job_id=job_id, status=job.status)


@app.get("/media-ingestion/{job_id}", response_model=MediaIngestionJob)
def get_media_ingestion_job(job_id: str) -> MediaIngestionJob:
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return job


@app.get("/wardrobe/{user_id}", response_model=List[GarmentItem])
def get_wardrobe_endpoint(user_id: str) -> List[GarmentItem]:
    return get_wardrobe(user_id)


# ---------------------------------------------------------------------------
# Week-events endpoints
# ---------------------------------------------------------------------------


class WeekEventsBody(BaseModel):
    events: List[WeekEvent]


@app.get("/users/{user_id}/week-events", response_model=WeekEventsBody)
def get_week_events(user_id: str) -> WeekEventsBody:
    return WeekEventsBody(events=_storage_get_week_events(user_id))


@app.put("/users/{user_id}/week-events", response_model=WeekEventsBody)
def put_week_events(user_id: str, body: WeekEventsBody) -> WeekEventsBody:
    store_week_events(user_id, body.events)
    return body


# ---------------------------------------------------------------------------
# Wardrobe mutation endpoints
# ---------------------------------------------------------------------------


@app.post("/wardrobe/{user_id}/items", response_model=GarmentItem)
def add_wardrobe_item(user_id: str, request: AddGarmentRequest) -> GarmentItem:
    now = datetime.utcnow()
    formality = request.formality or GarmentFormality.CASUAL
    seasonality = request.seasonality or GarmentSeasonality.ALL_SEASON
    tags = build_garment_tags(
        category=request.category,
        formality=formality,
        seasonality=seasonality,
    )
    garment = GarmentItem(
        id=str(uuid4()),
        user_id=user_id,
        primary_image_url=request.primary_image_url,
        category=request.category,
        sub_category=request.name,
        color_primary=request.color,
        formality=formality,
        seasonality=seasonality,
        gender=request.gender,
        brand=(request.brand or "").strip() or None,
        tags=tags,
        created_at=now,
        updated_at=now,
    )
    return insert_garment(garment)


@app.post("/wardrobe/{user_id}/search-garment", response_model=List[SearchGarmentResult])
async def search_garment_images(user_id: str, request: SearchGarmentRequest) -> List[SearchGarmentResult]:
    """
    Lightweight onboarding: user types e.g. "Zara black linen shirt" and picks an image.

    Uses SerpAPI Google Images search to fetch product-style photos.
    Env required:
      - SERPAPI_KEY
    """
    api_key = (os.getenv("SERPAPI_KEY") or "").strip()
    base_query = (request.query or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Garment search not configured. Set SERPAPI_KEY in the backend env.",
        )
    if not base_query:
        raise HTTPException(status_code=400, detail="Missing query.")

    limit = max(1, min(20, int(request.limit or 20)))

    parts = [base_query]
    if request.gender and str(request.gender).strip().lower() in ("men", "women"):
        parts.append(f"for {request.gender.strip().lower()}")
    if request.color:
        parts.append(str(request.color))
    if request.material:
        parts.append(str(request.material))
    if request.kind:
        parts.append(str(request.kind))
    parts.append("clothing product photo, studio, on white background")
    parts.append("-person -people -model -man -woman -face -selfie")

    query = " ".join(str(p).strip() for p in parts if str(p).strip())
    logger.info("Garment search start user_id=%s q=%r limit=%d", user_id, query, limit)

    url = "https://serpapi.com/search.json"
    params = {
        "engine": "google_images",
        "q": query,
        "api_key": api_key,
        "num": str(limit),
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, params=params)
            raw = resp.text
            if resp.status_code >= 400:
                logger.error("Garment search failed status=%d body=%s", resp.status_code, raw[:500])
                raise HTTPException(
                    status_code=502,
                    detail="Garment search provider failed. Check SERPAPI_KEY or try again later.",
                )
            data = resp.json()
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Garment search request error")
        raise HTTPException(status_code=502, detail="Garment search request failed. Please retry.") from exc

    items = data.get("images_results") if isinstance(data, dict) else []
    results: List[SearchGarmentResult] = []
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue
            link = item.get("original") or item.get("thumbnail")
            if not isinstance(link, str) or not link.strip():
                continue
            results.append(SearchGarmentResult(
                image_url=link.strip(),
                title=item.get("title") if isinstance(item.get("title"), str) else None,
                source_url=item.get("link") if isinstance(item.get("link"), str) else None,
            ))

    logger.info("Garment search complete user_id=%s results=%d", user_id, len(results))
    return results


# ---------------------------------------------------------------------------
# Vision endpoint
# ---------------------------------------------------------------------------


def _build_vision_previews_sync(user_id: str, extracted: List[ExtractedGarmentAsset]) -> List[VisionPreviewItem]:
    from .storage import upload_garment_image

    previews: List[VisionPreviewItem] = []
    for item in extracted:
        asset_id = str(uuid4())
        public_url = upload_garment_image(user_id, asset_id, item.image_bytes)
        previews.append(
            VisionPreviewItem(
                image_url=public_url,
                category=_safe_category(item.category),
                sub_category=item.sub_category,
                color_primary=item.color_primary,
                pattern=item.pattern,
                material=item.material,
                fit_notes=item.fit_style,
                formality=_safe_formality(item.formality),
                seasonality=_safe_seasonality(item.seasonality),
            )
        )
    return previews


@app.post("/vision/extract-preview", response_model=List[VisionPreviewItem])
async def extract_preview_from_image(
    user_id: str = Form(...),
    file: UploadFile = File(...),
) -> List[VisionPreviewItem]:
    """
    Vision onboarding (preview): generate product-style images + metadata but do NOT
    insert garments into the wardrobe yet. The client can choose which to commit.
    """
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    mime_type = file.content_type or "image/jpeg"
    logger.info(
        "Vision preview request user_id=%s filename=%s mime=%s bytes=%d",
        user_id, file.filename, mime_type, len(image_bytes),
    )

    try:
        extracted = await run_in_threadpool(extract_garments_from_image, image_bytes, mime_type)
    except RuntimeError as exc:
        logger.exception("Vision preview failed user_id=%s filename=%s", user_id, file.filename)
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if not extracted:
        raise HTTPException(
            status_code=422,
            detail="No garments detected from image. Please upload a clearer outfit photo.",
        )

    previews = await run_in_threadpool(_build_vision_previews_sync, user_id, extracted)
    return previews


def _commit_preview_items_sync(user_id: str, items: List[VisionPreviewItem]) -> List[GarmentItem]:
    now = datetime.utcnow()
    garments: List[GarmentItem] = []
    for item in items or []:
        formality = item.formality or GarmentFormality.CASUAL
        seasonality = item.seasonality or GarmentSeasonality.ALL_SEASON
        tags = build_garment_tags(item.category, formality, seasonality)
        garment_id = str(uuid4())
        garment = GarmentItem(
            id=garment_id,
            user_id=user_id,
            primary_image_url=item.image_url,
            category=item.category,
            sub_category=item.sub_category,
            color_primary=item.color_primary,
            pattern=item.pattern,
            material=item.material,
            fit_notes=item.fit_notes,
            formality=formality,
            seasonality=seasonality,
            tags=tags,
            created_at=now,
            updated_at=now,
        )
        garments.append(insert_garment(garment))
    return garments


@app.post("/vision/commit", response_model=List[GarmentItem])
async def commit_preview_items(user_id: str, request: VisionCommitRequest) -> List[GarmentItem]:
    """
    Persist selected preview items into the user's wardrobe.
    """
    bad_urls = [str(item.image_url) for item in (request.items or []) if not _is_trusted_image_url(str(item.image_url))]
    if bad_urls:
        raise HTTPException(status_code=400, detail="One or more image_url values are not from trusted storage.")

    garments = await run_in_threadpool(_commit_preview_items_sync, user_id, request.items or [])
    return garments


@app.post("/vision/extract", response_model=List[GarmentItem])
async def extract_wardrobe_from_image(
    user_id: str = Form(...),
    file: UploadFile = File(...),
) -> List[GarmentItem]:
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    mime_type = file.content_type or "image/jpeg"
    logger.info(
        "Vision extract request user_id=%s filename=%s mime=%s bytes=%d",
        user_id, file.filename, mime_type, len(image_bytes),
    )

    try:
        extracted = await run_in_threadpool(extract_garments_from_image, image_bytes, mime_type)
    except RuntimeError as exc:
        logger.exception("Vision extraction failed user_id=%s filename=%s", user_id, file.filename)
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if not extracted:
        raise HTTPException(
            status_code=422,
            detail="No garments detected from image. Please upload a clearer outfit photo.",
        )

    from .storage import upload_garment_image

    now = datetime.utcnow()
    garments: List[GarmentItem] = []
    for item in extracted:
        garment_id = str(uuid4())
        public_url = upload_garment_image(user_id, garment_id, item.image_bytes)
        garment = GarmentItem(
            id=garment_id,
            user_id=user_id,
            primary_image_url=public_url,
            category=_safe_category(item.category),
            sub_category=item.sub_category,
            color_primary=item.color_primary,
            pattern=item.pattern,
            material=item.material,
            fit_notes=item.fit_style,
            formality=_safe_formality(item.formality),
            seasonality=_safe_seasonality(item.seasonality),
            created_at=now,
            updated_at=now,
        )
        garments.append(insert_garment(garment))

    logger.info("Vision pipeline persisted user_id=%s inserted_items=%d", user_id, len(garments))
    return garments


# ---------------------------------------------------------------------------
# Body measurements endpoints
# ---------------------------------------------------------------------------


class MeasurementsBody(BaseModel):
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    chest_cm: Optional[float] = None
    waist_cm: Optional[float] = None
    hips_cm: Optional[float] = None
    inseam_cm: Optional[float] = None


@app.get("/users/{user_id}/measurements", response_model=Optional[BodyMeasurements])
def get_user_measurements(user_id: str) -> Optional[BodyMeasurements]:
    """Return saved body measurements for the user, or null if none exist."""
    return get_measurements(user_id)


@app.put("/users/{user_id}/measurements", response_model=BodyMeasurements)
def put_user_measurements(user_id: str, body: MeasurementsBody) -> BodyMeasurements:
    """Create or replace body measurements for the user."""
    now = datetime.utcnow()
    measurements = BodyMeasurements(
        user_id=user_id,
        height_cm=body.height_cm,
        weight_kg=body.weight_kg,
        chest_cm=body.chest_cm,
        waist_cm=body.waist_cm,
        hips_cm=body.hips_cm,
        inseam_cm=body.inseam_cm,
        updated_at=now,
    )
    return upsert_measurements(measurements)


# ---------------------------------------------------------------------------
# Hide/unhide garment endpoints
# ---------------------------------------------------------------------------


class HideGarmentBody(BaseModel):
    hidden: bool


@app.patch("/wardrobe/{user_id}/{garment_id}/hide", response_model=GarmentItem)
def patch_garment_hidden(user_id: str, garment_id: str, body: HideGarmentBody) -> GarmentItem:
    """Toggle whether a garment appears in outfit recommendations."""
    updated = set_garment_hidden(garment_id, user_id, body.hidden)
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Garment {garment_id} not found.")
    return updated


@app.delete("/wardrobe/{user_id}/{garment_id}", status_code=204)
def delete_wardrobe_item(user_id: str, garment_id: str) -> None:
    """Permanently remove a garment from the user's wardrobe."""
    try:
        found = delete_garment(garment_id, user_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to delete garment.") from exc
    if not found:
        raise HTTPException(status_code=404, detail=f"Garment {garment_id} not found.")
