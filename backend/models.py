from __future__ import annotations

from datetime import date, datetime
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


class GarmentGender(str, Enum):
    MEN = "men"
    WOMEN = "women"
    UNISEX = "unisex"


class LaundryStatus(str, Enum):
    CLEAN = "clean"
    IN_LAUNDRY = "in_laundry"


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

    # Gender target for this garment (None = unspecified, safe for all users).
    gender: Optional[GarmentGender] = None

    # Recommendation usage tracking.
    times_recommended: int = 0
    hidden_from_recommendations: bool = False

    # Wear tracking.
    laundry_status: LaundryStatus = LaundryStatus.CLEAN
    last_worn_date: Optional[date] = None
    times_worn: int = 0

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
# User profile (style preferences, sizes, avatar)
# ---------------------------------------------------------------------------


class AvatarConfig(BaseModel):
    """Bitmoji-style avatar configuration stored as a structured JSON object."""

    hair_style: Optional[str] = None
    """E.g. ``"short_wavy"``, ``"long_straight"``, ``"curly_afro"``."""

    hair_color: Optional[str] = None
    """E.g. ``"black"``, ``"blonde"``, ``"auburn"``."""

    body_type: Optional[str] = None
    """One of ``"slim"``, ``"average"``, ``"broad"``."""

    skin_tone: Optional[str] = None
    """One of ``"very_light"``, ``"light"``, ``"medium_light"``, ``"medium"``,
    ``"medium_dark"``, ``"dark"``."""


class UserProfile(BaseModel):
    """
    Extended style profile for a user.

    Measurements (height, chest, etc.) live in :class:`BodyMeasurements`.
    Auth identity lives in ``app_users``.
    This model captures the subjective style data that powers personalised
    colour/size filtering in the recommendation engine and the avatar feature.
    """

    user_id: str

    # --- Personal ---
    gender: Optional[str] = None
    """``"male"``, ``"female"``, or ``"other"``."""
    birthday: Optional[str] = None
    """ISO date string ``YYYY-MM-DD``."""

    # --- Appearance ---
    skin_tone: Optional[str] = None
    """One of ``"very_light"``, ``"light"``, ``"medium_light"``, ``"medium"``,
    ``"medium_dark"``, ``"dark"``."""

    color_tone: Optional[str] = None
    """Broad colour temperature: ``"warm"``, ``"cool"``, or ``"neutral"``."""

    # --- Colour preferences ---
    favorite_colors: List[str] = []
    """Colour names / hex codes the user wants prioritised in recommendations."""

    avoided_colors: List[str] = []
    """Colour names / hex codes the user wants de-prioritised or excluded."""

    # --- Sizes ---
    shoe_size: Optional[str] = None
    top_size: Optional[str] = None
    bottom_size: Optional[str] = None

    # --- Avatar ---
    avatar_config: Optional[AvatarConfig] = None

    updated_at: datetime


# ---------------------------------------------------------------------------
# Body measurements
# ---------------------------------------------------------------------------


class BodyMeasurements(BaseModel):
    """
    Optional user body measurements used to score fit when making outfit suggestions.
    All fields are optional; absent measurements are simply ignored by the engine.
    """

    user_id: str
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    chest_cm: Optional[float] = None
    waist_cm: Optional[float] = None
    hips_cm: Optional[float] = None
    inseam_cm: Optional[float] = None
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

    # Optional user context forwarded to the recommendation engine.
    user_gender: Optional[str] = None
    """Gender identity of the user (``"male"``, ``"female"``, or ``"other"``).
    When provided, garments tagged for the opposite binary gender are excluded."""

    include_laundry: bool = False
    """When True, items marked *in_laundry* are still eligible for recommendations."""


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


# ---------------------------------------------------------------------------
# Wear tracking & outfit history models
# ---------------------------------------------------------------------------


class WearLogEntry(BaseModel):
    """Single wear event for one garment."""

    id: str
    user_id: str
    garment_id: str
    worn_date: date
    created_at: datetime


class OutfitLogEntry(BaseModel):
    """Records which garments were worn together on a given date."""

    id: str
    user_id: str
    worn_date: date
    garment_ids: List[str] = []
    event_type: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime


class LogWearRequest(BaseModel):
    """Body for ``POST /wardrobe/{user_id}/{garment_id}/wear``."""

    worn_date: Optional[date] = None
    """Defaults to today when omitted."""


class SetLaundryRequest(BaseModel):
    """Body for ``PATCH /wardrobe/{user_id}/{garment_id}/laundry``."""

    status: LaundryStatus


class LogOutfitRequest(BaseModel):
    """Body for ``POST /users/{user_id}/outfit-log``."""

    worn_date: date
    garment_ids: List[str]
    event_type: Optional[str] = None
    notes: Optional[str] = None


class GarmentInsights(BaseModel):
    """Aggregated usage stats for a user's wardrobe."""

    most_worn: List[dict]
    """Top-5 garments by times_worn, each with ``garment_id`` and ``times_worn``."""

    not_worn_recently: List[str]
    """Garment ids not worn in the last 30 days (or never worn)."""

    total_items: int
    total_wears: int
