## Onboarding flows (MVP)

This document captures the initial onboarding flows for the AI Wardrobe Planner, aligned with the implementation plan.

### Primary flow order

1. **Flow A – Quick start (primary)**  
   Optimized for lowest friction and broadest appeal.
2. **Flow C – Manual add & cleanup (secondary)**  
   Always available as a safety net and correction tool.
3. **Flow B – Item-by-item guided capture (optional, later in session)**  
   Offered after quick start as an optional \"improve accuracy\" step.

### Flow A – Quick start (primary)

**Goal**: let a new user go from zero to a usable digital closet in minutes, with minimal manual work.

**Entry point**

- After sign-up / sign-in, new users see a short explainer and a primary CTA:
  - \"Digitize my closet (1–2 minutes)\"

**Steps**

1. **Basics**
   - Ask for:
     - Primary city (for weather context).
     - Typical dress style (chips: casual / business-casual / formal mix / not sure).
2. **Media upload**
   - Prompt for:
     - One short closet video (10–60 seconds), _or_
     - 5–15 photos of their closet.
   - Clear tips:
     - Open closet doors, good lighting, move slowly.
     - Try to keep the camera steady and avoid walking.
3. **Background processing**
   - Once upload completes:
     - Create a `MediaIngestionJob`.
     - Redirect the user to a \"We’re digitizing your closet\" screen with:
       - A progress indicator (job status polling).
       - A live-updating grid of detected items as they appear.
4. **First review**
   - As items appear:
     - Show each item as a card with thumbnail, category, and color chips.
     - Allow quick edits (change category, adjust color, delete obvious mistakes).
   - When job reaches a stable state:
     - Show summary:
       - \"We added 32 items from your video.\"
       - \"2 potential duplicates to review.\"
5. **Post-onboarding nudge**
   - Offer optional next steps:
     - \"Improve accuracy with guided capture\" (Flow B).
     - \"Add missing items manually\" (Flow C).

### Flow B – Item-by-item guided capture (optional)

**Goal**: give power users a way to capture high-value or missed items with higher accuracy.

**Entry points**

- Post-onboarding card: \"Improve accuracy with guided capture (2–5 minutes)\"
- Wardrobe screen action: \"Add items with camera\".

**Steps**

1. **Category selection**
   - User chooses a category group to work through:
     - Tops, Bottoms, Outerwear, Shoes, Accessories.
2. **Capture guidance**
   - For each category:
     - Show simple instructions and example framing.
     - Ask the user to place the garment on a contrasting surface or hang it on a door.
3. **Capture loop**
   - For each item:
     - Capture 1–3 photos (front, back, detail optional).
     - Run lightweight background removal and attribute tagging.
     - Show a confirmation card:
       - Thumbnail.
       - Detected category and color.
       - Optional quick edits.
4. **Completion**
   - After a few items:
     - Show stats (e.g., \"You’ve added 6 tops\") and a prompt to continue or finish.

### Flow C – Manual add & cleanup

**Goal**: provide a simple, always-available way to fix mistakes and add edge cases.

**Entry points**

- From the wardrobe screen: \"Add item\" button.
- From any item card: \"Edit\" / \"Merge\" / \"Delete\".

**Manual add steps**

1. **Image**
   - Upload a photo (or multiple) of the item.
2. **Metadata**
   - Required for MVP:
     - Category.
     - Subcategory.
   - Optional but suggested:
     - Primary color.
     - Secondary color.
     - Seasonality.
     - Formality.
3. **Save**
   - Create a new `GarmentItem` and show it in the wardrobe grid.

**Cleanup tools**

- Edit: change category, colors, seasonality, formality.
- Merge: merge one item into another (for near-duplicates).
- Delete: remove mis-detected or unwanted items.

### UX constraints & principles

- **Low friction first**: always lead with Quick start; guided capture and manual add are secondary.
- **Progress visibility**: for background processing, always show job status and items as they appear.
- **Fast corrections**: editing a mistake should take at most 1–2 taps.
- **Mobile-friendly**: all screens and flows should be easily usable on a phone browser.

