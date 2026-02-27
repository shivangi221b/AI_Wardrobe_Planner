## Onboarding wireframes (low-fidelity text)

This document describes low-fidelity wireframes for the key onboarding screens. Think of each section as a rough sketch of layout and content, not final design.

---

### Screen 1 – Welcome / value prop

- **Header**
  - Title: \"AI Wardrobe Planner\"
  - Subtitle: \"Turn your closet into a smart, searchable wardrobe.\"
- **Body**
  - Short bullet list:
    - \"See everything you own at a glance.\"
    - \"Get outfit ideas for your calendar events and weather.\"
    - \"Avoid buying duplicates and under-using great pieces.\"
- **Primary CTA**
  - Button: \"Digitize my closet (1–2 minutes)\"
- **Secondary**
  - Small text link: \"Skip for now\" (goes to empty wardrobe state).

---

### Screen 2 – Basics (city and style)

- **Header**
  - Title: \"Tell us a bit about you\"
- **Form fields**
  - Input: \"Primary city\" (autocomplete text field).
  - Label: \"How do you usually dress?\"\n    - Choice chips:
      - \"Mostly casual\"
      - \"Business casual\"
      - \"Formal mix\"
      - \"It depends\"
- **Footer**
  - Primary button: \"Continue\"
  - Back text: \"Back\" (returns to Welcome).

---

### Screen 3 – Media upload (closet video or photos)

- **Header**
  - Title: \"Capture your closet\"
- **Body layout**
  - Left/top: illustration or placeholder image of someone filming an open closet.
  - Right/bottom: instructions:
    - \"Option 1: record a 10–60 second video of your open closet. Move slowly, keep doors open, and avoid walking.\"
    - \"Option 2: upload 5–15 photos of your closet or drawers.\"
- **Upload area**
  - Large dropzone with icon:
    - \"Drop video or photos here\".
    - Buttons:
      - \"Upload video\"
      - \"Upload photos\"
- **Footer**
  - Primary button (disabled until at least one file is selected): \"Upload and analyze\"
  - Text hint: \"You can keep using the app while we process your closet.\"

---

### Screen 4 – Processing / progress

- **Header**
  - Title: \"We’re digitizing your closet\"
- **Body**
  - Progress indicator:
    - Horizontal bar with text: \"Analyzing your video (45%)\".
  - Status messages:
    - \"Extracting frames\"
    - \"Detecting garments\"
    - \"Tagging colors and categories\"
  - Live grid:
    - A responsive grid of item cards that fill in as they are detected.
    - Each card:
      - Thumbnail image.
      - Label row: category and color chips (e.g., \"Top\", \"Red\").
      - Small link: \"Edit\".
- **Footer**
  - Text: \"You can leave this screen; we’ll keep working in the background.\"

---

### Screen 5 – Inventory review

- **Header**
  - Title: \"Review your wardrobe\"
  - Subtitle: \"We found 32 items from your video.\"
- **Filter bar**
  - Category filter chips:
    - \"All\", \"Tops\", \"Bottoms\", \"Dresses\", \"Outerwear\", \"Shoes\", \"Accessories\".
  - Search box: \"Search by color, type, or brand\".
- **Main content**
  - Grid of garment cards:
    - Thumbnail.
    - Text: subcategory (e.g., \"T‑shirt\", \"Jeans\").
    - Chips: primary color, seasonality, formality.
    - Inline actions:
      - Small pencil icon: edit attributes.
      - Trash icon: delete.
  - Sidebar or bottom panel:
    - \"Possible duplicates\" section listing a few pairs with a \"Merge\" button.
- **Footer**
  - Primary button: \"Looks good\" (moves user into the main app).
  - Secondary button: \"Add missing items\" (launches guided capture).

---

### Screen 6 – Guided capture (optional)

- **Header**
  - Title: \"Add more items (optional)\"
  - Subtitle: \"Capture specific pieces we might have missed.\"
- **Body**
  - Category selector:
    - Chips or tabs: \"Tops\", \"Bottoms\", \"Outerwear\", \"Shoes\", \"Accessories\".
  - Capture module:
    - Live camera preview (on mobile) or upload button (on web).
    - Instruction text: \"Place one item on a flat, contrasting surface and fill most of the frame.\"
    - Button: \"Capture item\".
  - After capture:
    - Show a confirmation card:
      - Cropped thumbnail.
      - Auto-detected category and color.
      - Dropdowns/chips to adjust category, color, seasonality, formality.
      - Button: \"Save item\".
- **Footer**
  - Primary button: \"Done for now\" (returns to Inventory review / main app).

