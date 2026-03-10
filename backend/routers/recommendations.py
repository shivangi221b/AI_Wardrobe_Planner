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

from fastapi import APIRouter, HTTPException

from ..models import (
    DayOutfitSuggestion,
    WeekRecommendationRequest,
    WeekRecommendationResponse,
)
from ..recommendation import generate_week_recommendations
from ..storage import _wardrobes, _week_events

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
      "events": [
        { "day": "Monday", "event_type": "work_meeting" },
        { "day": "Friday", "event_type": "date_night", "location": "New York, NY",
          "datetime": "2026-03-13T19:00:00" }
      ]
    }
    ```

    The optional ``location`` and ``datetime`` fields on each event are accepted
    and stored but are not yet used by the rules engine.  They will be forwarded
    to the weather service once that is integrated.

    Returns 404 if the ``user_id`` is completely unknown (absent from both the
    wardrobe store and the week-events store).  An empty wardrobe is valid and
    returns graceful "No item found" recommendations.
    """
    user_known = request.user_id in _wardrobes or request.user_id in _week_events
    if not user_known:
        raise HTTPException(status_code=404, detail="User not found")

    wardrobe = _wardrobes.get(request.user_id, [])

    # Future: fetch weather per event and pass WeatherContext into the engine.
    # for event in request.events:
    #     if event.location and event.datetime:
    #         weather_data = await get_weather(event.location, event.datetime)
    #         ctx = WeatherContext(weather=weather_data)
    #     else:
    #         ctx = WeatherContext()

    day_recommendations: list[DayOutfitSuggestion] = generate_week_recommendations(
        wardrobe, request.events
    )

    return WeekRecommendationResponse(recommendations=day_recommendations)
