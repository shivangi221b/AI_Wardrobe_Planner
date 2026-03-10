from __future__ import annotations

from typing import List

from .models import GarmentItem, WeekEvent

# In-memory stores for early prototyping; replace with a real database in production.
_wardrobes: dict[str, List[GarmentItem]] = {}
_week_events: dict[str, List[WeekEvent]] = {}


# ---------------------------------------------------------------------------
# Accessors — prefer these over importing the dicts directly
# ---------------------------------------------------------------------------


def get_wardrobe(user_id: str) -> List[GarmentItem]:
    """Return the garments for *user_id*, or an empty list if none exist."""
    return _wardrobes.get(user_id, [])


def store_week_events(user_id: str, events: List[WeekEvent]) -> None:
    """Persist (overwrite) the week plan for *user_id*."""
    _week_events[user_id] = list(events)


def user_exists(user_id: str) -> bool:
    """Return True if *user_id* has any record in either store."""
    return user_id in _wardrobes or user_id in _week_events
