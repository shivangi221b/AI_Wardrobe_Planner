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
    """Return a copy of the garments for *user_id*, or an empty list if none exist.

    A copy is returned so callers cannot accidentally mutate in-memory state.
    Use :func:`add_garments` or :func:`set_wardrobe` to write changes back.
    """
    return list(_wardrobes.get(user_id, []))


def set_wardrobe(user_id: str, items: List[GarmentItem]) -> None:
    """Replace the entire wardrobe for *user_id* with *items*."""
    _wardrobes[user_id] = list(items)


def add_garments(user_id: str, items: List[GarmentItem]) -> None:
    """Append *items* to the wardrobe for *user_id*.

    Intended for use by the ingestion worker once it finishes processing a job.
    """
    if user_id not in _wardrobes:
        _wardrobes[user_id] = []
    _wardrobes[user_id].extend(items)


def store_week_events(user_id: str, events: List[WeekEvent]) -> None:
    """Persist (overwrite) the week plan for *user_id*."""
    _week_events[user_id] = list(events)


def user_exists(user_id: str) -> bool:
    """Return True if *user_id* has any record in either store."""
    return user_id in _wardrobes or user_id in _week_events
