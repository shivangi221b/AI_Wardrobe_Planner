from __future__ import annotations

import os
from datetime import datetime
from typing import List
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .models import GarmentItem, MediaIngestionJob, MediaIngestionStatus, MediaType
from .routers import recommendations, weather_router
from .storage import get_wardrobe

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

app.include_router(recommendations.router)
app.include_router(weather_router.router)


class MediaIngestionRequest(BaseModel):
    user_id: str
    media_type: MediaType
    source_uri: str


class MediaIngestionResponse(BaseModel):
    job_id: str
    status: MediaIngestionStatus


# In-memory store for ingestion jobs; replace with a real database in production.
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
