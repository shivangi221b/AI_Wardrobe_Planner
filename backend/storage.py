from __future__ import annotations

from typing import List

from .models import GarmentItem, WeekEvent

# In-memory stores for early prototyping; replace with a real database in production.
_wardrobes: dict[str, List[GarmentItem]] = {}
_week_events: dict[str, List[WeekEvent]] = {}
