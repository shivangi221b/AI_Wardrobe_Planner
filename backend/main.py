from __future__ import annotations

import os
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
from pydantic import HttpUrl
from starlette.concurrency import run_in_threadpool

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
from .storage import get_wardrobe
from .storage import upload_garment_image

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Wardrobe Planner API", version="0.1.0")

# Origins are driven by the ALLOWED_ORIGINS environment variable so the same
# binary can serve local dev and staging without code changes.
# Set ALLOWED_ORIGINS to a comma-separated list of trusted origins in production.
# Example: ALLOWED_ORIGINS="https://app.misfitai.com,https://staging.misfitai.com"
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:8081,http://localhost:3000")
_allowed_origins: list[str] = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
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
    primary_image_url: HttpUrl


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
