## AI Wardrobe Planner

Smart wardrobe assistant that connects to a user's calendars, location, and wardrobe inventory to recommend outfits tailored to events and weather.

### Current focus: onboarding & wardrobe inventory

For the first milestone we are focusing on:

- **Quick-start onboarding**: new users upload short closet videos or a small set of photos and see their digital wardrobe appear over time.
- **Guided item capture**: optional step-by-step flow for high-accuracy item capture.
- **Manual cleanup**: simple tools to edit, merge, or delete items after automated import.

### High-level architecture (MVP)

- **Backend**: Python + FastAPI, PostgreSQL for persistence.
- **Vision worker**: Python pipeline (YOLOv8 + EfficientSAM + CLIP) running as a separate service for media ingestion and wardrobe extraction.
- **Client(s)**: initially a simple web client for onboarding and wardrobe review (mobile-friendly), with native mobile capture planned later.

See `docs/onboarding.md` for detailed onboarding flows and `docs/onboarding_wireframes.md` for low-fidelity wireframes.

