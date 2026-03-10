"""
routers/weather_router.py — Weather route stub for misfitAI.

This router exposes a ``GET /weather`` endpoint that currently returns a
"not implemented" response.  Once a real weather API is integrated in
``backend/weather.py``, replace the response body here with a call to
``get_weather`` and return a serialised :class:`WeatherData` instance.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter

router = APIRouter(prefix="/weather", tags=["weather"])


@router.get("/")
async def get_weather_stub(
    location: str,
    datetime: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Placeholder endpoint for weather lookups.

    Query parameters
    ----------------
    location : str
        Free-text location string, e.g. ``"New York, NY"``.
    datetime : str, optional
        ISO 8601 datetime string for the desired forecast time,
        e.g. ``"2026-03-13T19:00:00"``.

    Returns a static "not implemented" payload until a real weather API
    is wired in.  The ``location`` and ``datetime`` inputs are echoed back
    so callers can confirm their request was received correctly.
    """
    return {
        "status": "not_implemented",
        "message": "Weather API coming soon",
        "location": location,
        "datetime": datetime,
    }
