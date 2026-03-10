from __future__ import annotations

from datetime import datetime
from typing import List
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .models import GarmentItem, MediaIngestionJob, MediaIngestionStatus, MediaType
from .routers import recommendations, weather_router

app = FastAPI(title="AI Wardrobe Planner API", version="0.1.0")

app.include_router(recommendations.router)
app.include_router(weather_router.router)


class MediaIngestionRequest(BaseModel):
    user_id: str
    media_type: MediaType
    source_uri: str


class MediaIngestionResponse(BaseModel):
    job_id: str
    status: MediaIngestionStatus


# In-memory stores for early prototyping; replace with database in real deployment.
_jobs: dict[str, MediaIngestionJob] = {}
_wardrobes: dict[str, List[GarmentItem]] = {}


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
    return _wardrobes.get(user_id, [])

