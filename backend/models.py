from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, HttpUrl


class GarmentCategory(str, Enum):
    TOP = "top"
    BOTTOM = "bottom"
    DRESS = "dress"
    OUTERWEAR = "outerwear"
    SHOES = "shoes"
    ACCESSORY = "accessory"


class GarmentFormality(str, Enum):
    CASUAL = "casual"
    SMART_CASUAL = "smart_casual"
    BUSINESS = "business"
    FORMAL = "formal"


class GarmentSeasonality(str, Enum):
    HOT = "hot"
    MILD = "mild"
    COLD = "cold"
    ALL_SEASON = "all_season"


class GarmentItem(BaseModel):
    """
    Core wardrobe entity for a user.
    """

    id: str
    user_id: str

    primary_image_url: HttpUrl
    alt_image_urls: List[HttpUrl] = []

    category: GarmentCategory
    sub_category: Optional[str] = None

    color_primary: Optional[str] = None
    color_secondary: Optional[str] = None
    pattern: Optional[str] = None

    formality: Optional[GarmentFormality] = None
    seasonality: Optional[GarmentSeasonality] = None

    # Optional descriptive fields
    brand: Optional[str] = None
    size: Optional[str] = None
    material: Optional[str] = None
    fit_notes: Optional[str] = None

    # Opaque embedding identifier; actual vector stored in a separate service/index.
    embedding_id: Optional[str] = None

    created_at: datetime
    updated_at: datetime


class MediaIngestionStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class MediaType(str, Enum):
    IMAGE_BATCH = "image_batch"
    VIDEO = "video"


class MediaIngestionJob(BaseModel):
    """
    Tracks processing of an uploaded closet video or image batch.
    """

    id: str
    user_id: str

    media_type: MediaType
    source_uri: str  # storage location (e.g., s3://... or gs://...)

    status: MediaIngestionStatus = MediaIngestionStatus.PENDING
    progress: float = 0.0  # 0.0 - 1.0

    error_message: Optional[str] = None

    # Metadata useful for tuning the pipeline.
    frame_count: Optional[int] = None
    detected_items_count: Optional[int] = None

    created_at: datetime
    updated_at: datetime

