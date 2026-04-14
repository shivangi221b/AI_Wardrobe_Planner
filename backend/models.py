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


def build_garment_tags(
    category: GarmentCategory,
    formality: Optional[GarmentFormality] = None,
    seasonality: Optional[GarmentSeasonality] = None,
) -> list[str]:
    """
    Derive simple string tags for a garment from the core enums.

    These tags are intended for downstream recommendation / retrieval systems
    and are kept intentionally compact:

    - Always includes the garment category value, e.g. ``"top"``.
    - Includes formality (if present), e.g. ``"smart_casual"``.
    - Includes seasonality (if present), e.g. ``"all_season"``.
    """
    tags: list[str] = [category.value]
    if formality is not None:
        tags.append(formality.value)
    if seasonality is not None:
        tags.append(seasonality.value)
    return tags


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

    # Simple machine-readable tags derived from the enums above.  Persisted
    # only in the API surface; database backends may recompute these from the
    # structured fields.
    tags: List[str] = []

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


# ---------------------------------------------------------------------------
# Weekly outfit recommendation models
# ---------------------------------------------------------------------------


class WeekEvent(BaseModel):
    """
    A single calendar event for one day of the week.

    ``location`` and ``datetime`` are optional hooks for future weather/
    location-aware recommendations.  Omitting them keeps the payload
    identical to today's schema so no existing callers break.
    """

    day: str
    """Day of the week, e.g. ``"Monday"``."""

    event_type: str
    """Informal label for the event, e.g. ``"work"``, ``"gym"``, ``"date"``."""

    original_summary: Optional[str] = None
    """The original Google Calendar event title, if available."""

    location: Optional[str] = None
    """Free-text location string, e.g. ``"New York, NY"``.
    Will be forwarded to the weather service once it is integrated."""

    datetime: Optional[datetime] = None
    """ISO 8601 datetime for the event.  Used together with ``location`` to
    fetch a point-in-time weather forecast."""


class WeekRecommendationRequest(BaseModel):
    """Request body for ``POST /recommendations/week``."""

    user_id: str
    events: List[WeekEvent]


class DayOutfitSuggestion(BaseModel):
    """Structured outfit recommendation for a single day."""

    day: str
    event_type: str
    top_id: Optional[str] = None
    bottom_id: Optional[str] = None
    top_name: Optional[str] = None
    bottom_name: Optional[str] = None
    dress_id: Optional[str] = None
    dress_name: Optional[str] = None
    explanation: str


class WeekRecommendationResponse(BaseModel):
    """Response body for ``POST /recommendations/week``."""

    user_id: str
    recommendations: List[DayOutfitSuggestion]

