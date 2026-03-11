"""
tests/test_recommendations_e2e.py — End-to-end tests for POST /recommendations/week.

Requires a real OPENAI_API_KEY in the environment.  The entire module is
skipped automatically when the key is absent so CI runs that don't have
the secret still pass.

Run:
    OPENAI_API_KEY=sk-... pytest tests/test_recommendations_e2e.py -v

Override model (cheaper during dev):
    OPENAI_API_KEY=sk-... OPENAI_MODEL=gpt-4o-mini pytest tests/test_recommendations_e2e.py -v
"""

from __future__ import annotations

import os

import pytest

# ---------------------------------------------------------------------------
# Module-level skip — must happen BEFORE backend imports because llm.py
# validates OPENAI_API_KEY at import time and raises EnvironmentError.
# ---------------------------------------------------------------------------
if not os.getenv("OPENAI_API_KEY"):
    pytest.skip("OPENAI_API_KEY is not set — skipping e2e tests", allow_module_level=True)

from datetime import datetime  # noqa: E402 (import after env check)

import httpx  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import AsyncClient, ASGITransport  # noqa: E402

from backend.main import app  # noqa: E402
from backend.models import (  # noqa: E402
    GarmentCategory,
    GarmentFormality,
    GarmentItem,
)
from backend.storage import add_garments, set_wardrobe  # noqa: E402

# ---------------------------------------------------------------------------
# Shared test data
# ---------------------------------------------------------------------------

_USER_ID = "e2e-test-user"

_NOW = datetime.utcnow()

# A minimal wardrobe with one formal top/bottom and one casual/activewear pair.
_WARDROBE: list[GarmentItem] = [
    GarmentItem(
        id="top-formal",
        user_id=_USER_ID,
        primary_image_url="https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400",
        category=GarmentCategory.TOP,
        sub_category="shirt",
        color_primary="white",
        formality=GarmentFormality.FORMAL,
        brand="Zara",
        created_at=_NOW,
        updated_at=_NOW,
    ),
    GarmentItem(
        id="bottom-formal",
        user_id=_USER_ID,
        primary_image_url="https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=400",
        category=GarmentCategory.BOTTOM,
        sub_category="pants",
        color_primary="charcoal",
        formality=GarmentFormality.BUSINESS,
        brand="H&M",
        created_at=_NOW,
        updated_at=_NOW,
    ),
    GarmentItem(
        id="top-casual",
        user_id=_USER_ID,
        primary_image_url="https://images.unsplash.com/photo-1571945153237-4929e783af4a?w=400",
        category=GarmentCategory.TOP,
        sub_category="activewear_top",
        color_primary="black",
        formality=GarmentFormality.CASUAL,
        created_at=_NOW,
        updated_at=_NOW,
    ),
    GarmentItem(
        id="bottom-casual",
        user_id=_USER_ID,
        primary_image_url="https://images.unsplash.com/photo-1591195853828-11db59a44f43?w=400",
        category=GarmentCategory.BOTTOM,
        sub_category="activewear_bottom",
        color_primary="grey",
        formality=GarmentFormality.CASUAL,
        created_at=_NOW,
        updated_at=_NOW,
    ),
    GarmentItem(
        id="top-smart",
        user_id=_USER_ID,
        primary_image_url="https://images.unsplash.com/photo-1593030761757-71fae45fa0e7?w=400",
        category=GarmentCategory.TOP,
        sub_category="blouse",
        color_primary="burgundy",
        formality=GarmentFormality.SMART_CASUAL,
        brand="Mango",
        created_at=_NOW,
        updated_at=_NOW,
    ),
    GarmentItem(
        id="bottom-smart",
        user_id=_USER_ID,
        primary_image_url="https://images.unsplash.com/photo-1594938298603-c8148c4b4f6a?w=400",
        category=GarmentCategory.BOTTOM,
        sub_category="skirt",
        color_primary="black",
        formality=GarmentFormality.SMART_CASUAL,
        created_at=_NOW,
        updated_at=_NOW,
    ),
]

# Hardcoded template strings from the OLD implementation — the LLM output
# must NOT exactly match any of these.
_OLD_TEMPLATES = {
    "work_meeting": "from your wardrobe to keep you polished and professional.",
    "date_night": "to keep things stylish yet relaxed.",
    "gym": "to keep you moving.",
    "casual": "for a no-fuss look.",
}

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def seed_wardrobe():
    """Populate the in-memory wardrobe before each test and clear it after."""
    set_wardrobe(_USER_ID, _WARDROBE)
    yield
    set_wardrobe(_USER_ID, [])


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _find_rec(recommendations: list[dict], day: str) -> dict:
    for r in recommendations:
        if r["day"] == day:
            return r
    raise AssertionError(f"No recommendation found for day={day!r}")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_response_structure(client: AsyncClient):
    """Response contains all required fields for every event."""
    payload = {
        "user_id": _USER_ID,
        "events": [
            {"day": "Monday", "event_type": "work_meeting"},
            {"day": "Wednesday", "event_type": "gym"},
            {"day": "Friday", "event_type": "date_night"},
        ],
    }
    response = await client.post("/recommendations/week", json=payload)
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["user_id"] == _USER_ID
    assert len(body["recommendations"]) == 3

    required_fields = {"day", "event_type", "top_id", "bottom_id", "top_name", "bottom_name", "explanation"}
    for rec in body["recommendations"]:
        missing = required_fields - rec.keys()
        assert not missing, f"Missing fields {missing} in {rec}"


@pytest.mark.asyncio
async def test_work_meeting_picks_formal_items(client: AsyncClient):
    """work_meeting → top-formal (shirt/formal) and bottom-formal (pants/business)."""
    payload = {
        "user_id": _USER_ID,
        "events": [{"day": "Monday", "event_type": "work_meeting"}],
    }
    response = await client.post("/recommendations/week", json=payload)
    assert response.status_code == 200

    rec = _find_rec(response.json()["recommendations"], "Monday")
    assert rec["top_id"] == "top-formal", f"Expected formal top, got {rec['top_id']}"
    assert rec["bottom_id"] == "bottom-formal", f"Expected formal bottom, got {rec['bottom_id']}"
    assert rec["top_name"] == "Zara shirt"
    assert rec["bottom_name"] == "H&M pants"


@pytest.mark.asyncio
async def test_gym_picks_casual_activewear(client: AsyncClient):
    """gym → top-casual (activewear_top) and bottom-casual (activewear_bottom)."""
    payload = {
        "user_id": _USER_ID,
        "events": [{"day": "Wednesday", "event_type": "gym"}],
    }
    response = await client.post("/recommendations/week", json=payload)
    assert response.status_code == 200

    rec = _find_rec(response.json()["recommendations"], "Wednesday")
    assert rec["top_id"] == "top-casual"
    assert rec["bottom_id"] == "bottom-casual"


@pytest.mark.asyncio
async def test_date_night_picks_smart_casual(client: AsyncClient):
    """date_night → smart_casual items preferred over formal or casual."""
    payload = {
        "user_id": _USER_ID,
        "events": [{"day": "Friday", "event_type": "date_night"}],
    }
    response = await client.post("/recommendations/week", json=payload)
    assert response.status_code == 200

    rec = _find_rec(response.json()["recommendations"], "Friday")
    assert rec["top_id"] == "top-smart"
    assert rec["bottom_id"] == "bottom-smart"


@pytest.mark.asyncio
async def test_explanations_are_llm_generated(client: AsyncClient):
    """Explanations must not be verbatim copies of the old hardcoded templates."""
    payload = {
        "user_id": _USER_ID,
        "events": [
            {"day": "Monday", "event_type": "work_meeting"},
            {"day": "Wednesday", "event_type": "gym"},
            {"day": "Friday", "event_type": "date_night"},
            {"day": "Sunday", "event_type": "casual"},
        ],
    }
    response = await client.post("/recommendations/week", json=payload)
    assert response.status_code == 200

    for rec in response.json()["recommendations"]:
        explanation = rec["explanation"]
        event_type = rec["event_type"]

        # Must be a non-empty string
        assert isinstance(explanation, str) and explanation.strip(), (
            f"Empty explanation for {event_type}"
        )

        # Must not be the old static template suffix
        old_suffix = _OLD_TEMPLATES.get(event_type, "")
        assert old_suffix not in explanation, (
            f"Explanation for {event_type} looks like a hardcoded template: {explanation!r}"
        )


@pytest.mark.asyncio
async def test_explanations_mention_garment_details(client: AsyncClient):
    """LLM explanations should reference at least one garment attribute."""
    payload = {
        "user_id": _USER_ID,
        "events": [{"day": "Monday", "event_type": "work_meeting"}],
    }
    response = await client.post("/recommendations/week", json=payload)
    assert response.status_code == 200

    rec = _find_rec(response.json()["recommendations"], "Monday")
    explanation = rec["explanation"].lower()

    # The LLM received "Zara shirt — white, formal" and "H&M pants — charcoal, business".
    # At least one of these tokens should appear in the explanation.
    garment_tokens = {"zara", "shirt", "white", "formal", "h&m", "pants", "charcoal", "business"}
    matched = garment_tokens & set(explanation.split())
    assert matched, (
        f"Explanation doesn't reference any garment detail. Got: {rec['explanation']!r}"
    )


@pytest.mark.asyncio
async def test_empty_wardrobe_graceful_fallback(client: AsyncClient):
    """With no garments, the endpoint returns 'No item found' names but still explains."""
    set_wardrobe(_USER_ID, [])

    payload = {
        "user_id": _USER_ID,
        "events": [{"day": "Monday", "event_type": "work_meeting"}],
    }
    response = await client.post("/recommendations/week", json=payload)
    assert response.status_code == 200

    rec = _find_rec(response.json()["recommendations"], "Monday")
    assert rec["top_id"] is None
    assert rec["bottom_id"] is None
    assert rec["top_name"] == "No item found"
    assert rec["bottom_name"] == "No item found"
    assert isinstance(rec["explanation"], str) and rec["explanation"].strip()


@pytest.mark.asyncio
async def test_multi_event_no_duplicate_items(client: AsyncClient):
    """The same garment should not be assigned to two different events in the same week."""
    payload = {
        "user_id": _USER_ID,
        "events": [
            {"day": "Monday", "event_type": "work_meeting"},
            {"day": "Tuesday", "event_type": "work_meeting"},
            {"day": "Wednesday", "event_type": "gym"},
        ],
    }
    response = await client.post("/recommendations/week", json=payload)
    assert response.status_code == 200

    recs = response.json()["recommendations"]
    used_top_ids = [r["top_id"] for r in recs if r["top_id"]]
    used_bottom_ids = [r["bottom_id"] for r in recs if r["bottom_id"]]

    assert len(used_top_ids) == len(set(used_top_ids)), (
        f"Duplicate top IDs across events: {used_top_ids}"
    )
    assert len(used_bottom_ids) == len(set(used_bottom_ids)), (
        f"Duplicate bottom IDs across events: {used_bottom_ids}"
    )


@pytest.mark.asyncio
async def test_payload_is_small(client: AsyncClient):
    """Response items must not contain nested garment objects — only ids/names."""
    payload = {
        "user_id": _USER_ID,
        "events": [{"day": "Monday", "event_type": "work_meeting"}],
    }
    response = await client.post("/recommendations/week", json=payload)
    assert response.status_code == 200

    rec = _find_rec(response.json()["recommendations"], "Monday")

    # These keys must be simple scalars, not nested dicts
    for field in ("top_id", "bottom_id", "top_name", "bottom_name", "explanation"):
        value = rec[field]
        assert not isinstance(value, dict), (
            f"Field {field!r} is a nested object — payload is not small: {value}"
        )
