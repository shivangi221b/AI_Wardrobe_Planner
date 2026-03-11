from __future__ import annotations

from datetime import datetime
import logging
import os
from pathlib import Path
from typing import List, Optional
from uuid import uuid4

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from vision.extractor import extract_garments_from_image

from .db import get_wardrobe as get_wardrobe_items
from .db import insert_garment
from .models import (
    GarmentCategory,
    GarmentFormality,
    GarmentItem,
    GarmentSeasonality,
    MediaIngestionJob,
    MediaIngestionStatus,
    MediaType,
)
from .routers import recommendations, weather_router
from .storage import upload_garment_image

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Wardrobe Planner API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8081",
        "http://127.0.0.1:8081",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(recommendations.router)
app.include_router(weather_router.router)

_local_assets_dir = Path(os.getenv("LOCAL_GARMENTS_DIR", "outputs/local_garments"))
_local_assets_dir.mkdir(parents=True, exist_ok=True)
app.mount(
    "/assets/local-garments",
    StaticFiles(directory=str(_local_assets_dir)),
    name="local-garments",
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
    primary_image_url: str


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

    # A separate worker service will pick up this job and update its status and
    # populate the user's wardrobe.

    return MediaIngestionResponse(job_id=job_id, status=job.status)


@app.get("/media-ingestion/{job_id}", response_model=MediaIngestionJob)
def get_media_ingestion_job(job_id: str) -> MediaIngestionJob:
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return job


@app.get("/wardrobe/{user_id}", response_model=List[GarmentItem])
def get_wardrobe(user_id: str) -> List[GarmentItem]:
    items = get_wardrobe_items(user_id)
    logger.info("Wardrobe fetch complete user_id=%s items=%d", user_id, len(items))
    return items


@app.post("/wardrobe/{user_id}/items", response_model=GarmentItem)
def add_wardrobe_item(user_id: str, request: AddGarmentRequest) -> GarmentItem:
    now = datetime.utcnow()
    garment = GarmentItem(
        id=str(uuid4()),
        user_id=user_id,
        primary_image_url=request.primary_image_url,
        category=request.category,
        sub_category=request.name,
        color_primary=request.color,
        formality=request.formality,
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

    # Build a richer query: base text + structured filters, plus hints to avoid faces/people.
    parts = [base_query]
    if request.gender and str(request.gender).strip().lower() in ("men", "women"):
        parts.append(f"for {request.gender.strip().lower()}")
    if request.color:
        parts.append(str(request.color))
    if request.material:
        parts.append(str(request.material))
    if request.kind:
        parts.append(str(request.kind))

    # Bias toward isolated product photos from shopping-style results.
    parts.append("clothing product photo, studio, on white background")
    # Try to down-rank images with models/people.
    parts.append("-person -people -model -man -woman -face -selfie")

    query = " ".join(str(p).strip() for p in parts if str(p).strip())

    logger.info("Garment search start user_id=%s q=%r limit=%d", user_id, query, limit)

    # SerpAPI Google Images endpoint.
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
                logger.error("Garment search failed status=%d body=%s", resp.status_code, raw[:5000])
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
            # SerpAPI google_images: 'original' is the full-size image URL.
            link = item.get("original") or item.get("thumbnail")
            if not isinstance(link, str) or not link.strip():
                continue
            image_url = link.strip()
            title = item.get("title") if isinstance(item.get("title"), str) else None
            source_url = item.get("link") if isinstance(item.get("link"), str) else None
            results.append(SearchGarmentResult(image_url=image_url, title=title, source_url=source_url))

    logger.info("Garment search complete user_id=%s results=%d", user_id, len(results))
    return results


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
        "Vision extract request received user_id=%s filename=%s mime=%s bytes=%d",
        user_id,
        file.filename,
        mime_type,
        len(image_bytes),
    )
    try:
        extracted = extract_garments_from_image(image_bytes, mime_type=mime_type)
    except RuntimeError as exc:
        logger.exception("Vision extraction failed user_id=%s filename=%s", user_id, file.filename)
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if not extracted:
        raise HTTPException(
            status_code=422,
            detail="No garments detected from image. Please upload a clearer outfit photo.",
        )

    now = datetime.utcnow()
    logger.info("Vision extraction complete user_id=%s detected_items=%d", user_id, len(extracted))

    garments: List[GarmentItem] = []
    for item in extracted:
        garment_id = str(uuid4())
        public_url = upload_garment_image(user_id, garment_id, item.image_bytes)
        logger.info(
            "Garment asset saved user_id=%s garment_id=%s category=%s image_url=%s",
            user_id,
            garment_id,
            item.category,
            public_url,
        )
        garment = GarmentItem(
            id=garment_id,
            user_id=user_id,
            primary_image_url=public_url,
            category=_safe_category(item.category),
            sub_category=item.sub_category,
            color_primary=item.color_primary,
            formality=_safe_formality(item.formality),
            seasonality=_safe_seasonality(item.seasonality),
            created_at=now,
            updated_at=now,
        )
        garments.append(insert_garment(garment))

    logger.info("Vision pipeline persisted user_id=%s inserted_items=%d", user_id, len(garments))
    return garments

