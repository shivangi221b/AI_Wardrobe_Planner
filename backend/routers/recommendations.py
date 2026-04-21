"""
routers/recommendations.py — Outfit recommendation endpoints.

The rules engine in ``backend/recommendation.py`` is intentionally
weather-agnostic for now.  A ``WeatherContext`` parameter is stubbed out in
comments so that adding weather-awareness later requires only:
  1. Un-commenting the import and parameter.
  2. Calling ``get_weather`` per event (see ``backend/weather.py`` for details).
  3. Passing the resulting ``WeatherContext`` into ``generate_week_recommendations``.
"""

from __future__ import annotations

from fastapi import APIRouter

from ..db import get_measurements, get_user_profile, increment_recommendation_counts
from ..models import (
    DayOutfitSuggestion,
    WeekRecommendationRequest,
    WeekRecommendationResponse,
)
from ..recommendation import generate_week_recommendations
from ..storage import get_wardrobe, store_week_events

# Future import — un-comment once weather integration is ready:
# from ..weather import WeatherContext, get_weather

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/week", response_model=WeekRecommendationResponse)
async def recommend_week(
    request: WeekRecommendationRequest,
) -> WeekRecommendationResponse:
    """
    Return structured outfit recommendations for each event in a user's week.

    **Request body**

    ```json
    {
      "user_id": "u_123",
      "user_gender": "female",
      "events": [
        { "day": "Monday", "event_type": "work_meeting" },
        { "day": "Friday", "event_type": "date_night", "location": "New York, NY",
          "datetime": "2026-03-13T19:00:00" }
      ]
    }
    ```

    Incoming events are persisted to the week-events store so that the user's
    plan is available to future endpoints (e.g. weather integration).  The
    optional ``location`` and ``datetime`` fields are stored but not yet used
    by the rules engine; they will be forwarded to the weather service once
    that is integrated.

    An empty or unknown wardrobe is valid — recommendations are returned with
    ``"No item found"`` entries rather than an error.
    """
    # Persist the submitted week plan so the user is registered in storage
    # and the events are available for future weather / analytics lookups.
    store_week_events(request.user_id, request.events)

    wardrobe = get_wardrobe(request.user_id)

    # Load optional body measurements for soft size-band scoring.
    measurements = get_measurements(request.user_id)

    # Load optional extended profile for colour preference scoring.
    user_profile = get_user_profile(request.user_id)

    # Future: fetch weather per event and pass WeatherContext into the engine.
    # for event in request.events:
    #     if event.location and event.datetime:
    #         weather_data = await get_weather(event.location, event.datetime)
    #         ctx = WeatherContext(weather=weather_data)
    #     else:
    #         ctx = WeatherContext()

    day_recommendations: list[DayOutfitSuggestion] = await generate_week_recommendations(
        wardrobe,
        request.events,
        user_gender=request.user_gender,
        measurements=measurements,
        user_profile=user_profile,
    )

    # Increment usage counters for recommended garments (best-effort).
    recommended_ids = [
        gid
        for rec in day_recommendations
        for gid in [rec.top_id, rec.bottom_id]
        if gid is not None
    ]
    increment_recommendation_counts(recommended_ids, request.user_id)

    return WeekRecommendationResponse(
        user_id=request.user_id,
        recommendations=day_recommendations,
    )
