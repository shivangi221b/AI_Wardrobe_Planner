"""
routers/recommendations.py — Outfit recommendation endpoints.

The rules engine in this file is intentionally weather-agnostic for now.
A ``WeatherContext`` parameter is stubbed out in comments so that adding
weather-awareness later requires only:
  1. Un-commenting the import and parameter.
  2. Calling ``get_weather`` per event (see ``backend/weather.py`` for details).
  3. Passing the resulting ``WeatherContext`` into ``_build_suggestion``.
"""

from __future__ import annotations

from typing import List

from fastapi import APIRouter

from ..models import (
    DayOutfitSuggestion,
    WeekEvent,
    WeekRecommendationRequest,
    WeekRecommendationResponse,
)

# Future import — un-comment once weather integration is ready:
# from ..weather import WeatherContext, get_weather

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _build_suggestion(
    event: WeekEvent,
    # weather_context: Optional[WeatherContext] = None,  # future hook
) -> DayOutfitSuggestion:
    """
    Derive a plain-text outfit suggestion from a calendar event.

    This is the sole place where outfit rules live.  It is deliberately
    kept weather-agnostic; the ``weather_context`` parameter above shows
    exactly where to inject weather-aware logic once the API is integrated.

    Args:
        event: The calendar event for the day.

    Returns:
        A :class:`DayOutfitSuggestion` for that day.
    """
    suggestion = (
        f"Outfit suggestion for {event.event_type} on {event.day} — "
        "recommendation logic coming soon."
    )
    return DayOutfitSuggestion(
        day=event.day,
        event_type=event.event_type,
        suggestion=suggestion,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/week", response_model=WeekRecommendationResponse)
async def recommend_week(
    request: WeekRecommendationRequest,
) -> WeekRecommendationResponse:
    """
    Return outfit suggestions for each event in a user's week.

    **Request body**

    ```json
    {
      "user_id": "u_123",
      "events": [
        { "day": "Monday", "event_type": "work" },
        { "day": "Friday", "event_type": "date", "location": "New York, NY",
          "datetime": "2026-03-13T19:00:00" }
      ]
    }
    ```

    The optional ``location`` and ``datetime`` fields on each event are
    stored and passed through but are not yet used by the rules engine.
    They will be forwarded to the weather service once that is integrated.
    """
    suggestions: List[DayOutfitSuggestion] = []

    for event in request.events:
        # Future: fetch weather and pass WeatherContext into _build_suggestion
        # if event.location and event.datetime:
        #     weather_data = await get_weather(event.location, event.datetime)
        #     ctx = WeatherContext(weather=weather_data)
        # else:
        #     ctx = WeatherContext()
        # suggestion = _build_suggestion(event, weather_context=ctx)

        suggestion = _build_suggestion(event)
        suggestions.append(suggestion)

    return WeekRecommendationResponse(
        user_id=request.user_id,
        suggestions=suggestions,
    )
