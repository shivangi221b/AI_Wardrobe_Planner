"""
weather.py — Weather data models and fetch placeholder for misfitAI.

HOW TO PLUG IN A REAL WEATHER API
==================================
When you're ready to integrate a live weather service (e.g. OpenWeatherMap,
Tomorrow.io, or WeatherAPI), follow these steps:

1. **Choose an API and add credentials**
   Store your API key in an environment variable (e.g. ``WEATHER_API_KEY``)
   and load it via ``pydantic_settings.BaseSettings`` or ``os.getenv``.

2. **Implement ``get_weather``**
   Replace the placeholder body below with an actual HTTP call.  Use
   ``httpx.AsyncClient`` (already compatible with FastAPI's async model):

       async with httpx.AsyncClient() as client:
           resp = await client.get(
               "https://api.openweathermap.org/data/3.0/onecall",
               params={"lat": lat, "lon": lon, "dt": int(dt.timestamp()),
                       "appid": API_KEY, "units": "imperial"},
           )
           resp.raise_for_status()
           data = resp.json()

   Populate ``WeatherData`` from the response:
   - ``temperature_f`` ← ``data["current"]["temp"]``
   - ``condition``     ← ``data["current"]["weather"][0]["main"].lower()``
   - ``humidity``      ← ``data["current"]["humidity"]``
   - ``location``      ← the ``location`` arg you passed in
   - ``fetched_at``    ← ``datetime.utcnow()``

3. **Wire it into the recommendation flow**
   In ``routers/recommendations.py``, the ``POST /recommendations/week``
   handler already accepts an optional ``WeatherContext``.  Once this module
   returns real data, call it inside that handler for every ``WeekEvent``
   that has both ``location`` and ``datetime`` set, then pass the resulting
   ``WeatherContext`` into the rules engine.

   Suggested call site (inside the handler loop):

       if event.location and event.datetime:
           weather_data = await get_weather(event.location, event.datetime)
           ctx = WeatherContext(weather=weather_data)
       else:
           ctx = WeatherContext()
       # pass ctx to your suggestion logic

4. **Fields that influence outfit rules**
   - ``temperature_f`` → layer count, outerwear vs. no outerwear
   - ``condition``     → umbrella / rain-proof outerwear, sun-hat, etc.
   - ``humidity``      → breathable fabrics on high-humidity days
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from pydantic import BaseModel

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class WeatherData(BaseModel):
    """
    Snapshot of weather conditions at a specific location and time.

    All fields that a real API would return are present here so the
    recommendation engine can reference them without further schema changes.
    """

    temperature_f: float
    """Current temperature in degrees Fahrenheit."""

    condition: str
    """Human-readable condition label, e.g. ``"sunny"``, ``"rainy"``,
    ``"cloudy"``, ``"snowy"``."""

    humidity: float
    """Relative humidity as a percentage (0–100)."""

    location: str
    """Location string exactly as supplied to the fetch call."""

    fetched_at: datetime
    """UTC timestamp of when this data was retrieved from the upstream API."""


class WeatherContext(BaseModel):
    """
    Container that carries weather information through the recommendation
    pipeline.  Keeping it as a thin wrapper means the rules engine never
    needs to import weather-fetch logic directly.

    Pass an instance of this model as an optional parameter to any function
    that wants to be weather-aware, e.g.::

        async def build_suggestion(
            event: WeekEvent,
            weather_context: Optional[WeatherContext] = None,
        ) -> DayOutfitSuggestion:
            ...
    """

    weather: Optional[WeatherData] = None
    """Populated once a real weather API is integrated; ``None`` until then."""


# ---------------------------------------------------------------------------
# Fetch placeholder
# ---------------------------------------------------------------------------


async def get_weather(location: str, dt: datetime) -> Optional[WeatherData]:
    """
    Retrieve weather data for *location* at *dt*.

    Currently a no-op placeholder.  Returns ``None`` and logs a message so
    callers can handle the missing data gracefully (e.g. fall back to
    season-only rules).

    Args:
        location: Free-text location string, e.g. ``"New York, NY"``.
        dt: The datetime for which the forecast is needed (UTC preferred).

    Returns:
        A populated :class:`WeatherData` instance once a real API is wired
        in; ``None`` for now.
    """
    logger.info(
        "Weather fetch not yet implemented — skipping for location=%r dt=%s",
        location,
        dt.isoformat(),
    )
    return None
