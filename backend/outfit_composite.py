"""
outfit_composite.py — PIL-based outfit preview compositor.

Given the user's stored avatar portrait and a list of garment images, produces a
single JPEG that places the avatar portrait on the left and a layered grid of the
actual garment photos on the right — no AI generation, no text prompts, no
invented faces or clothes.

Layout (default 900 × 300 px output, 3:1 ratio):
  ┌─────────────┬──────────────────────┐
  │             │  [garment 1]         │
  │  avatar     │  [garment 2]         │
  │  portrait   │  [garment 3]         │
  │             │  [garment 4]         │
  └─────────────┴──────────────────────┘
"""

from __future__ import annotations

import asyncio
import io
import logging
from typing import Sequence

import httpx
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Layout constants
# ---------------------------------------------------------------------------

OUTPUT_W = 900
OUTPUT_H = 300          # 3:1 ratio — matches aspectRatio:3 in the mobile card
AVATAR_W = 200          # left column: ~22 % — small avatar thumbnail, not face poster
GARMENT_COL_W = OUTPUT_W - AVATAR_W  # right column: 700 px — clothes are primary
GUTTER = 8              # gap between garment cells and between columns
BG_COLOR = (250, 250, 248)    # matches palette.bg
LABEL_COLOR = (111, 112, 107)  # palette.muted
LABEL_FONT_SIZE = 11

_MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024   # 10 MB per image
_HTTP_TIMEOUT = 12.0                      # seconds


# ---------------------------------------------------------------------------
# Image fetching
# ---------------------------------------------------------------------------

async def _none_image() -> None:
    """Placeholder coroutine that returns None for garment items with no URL."""
    return None


async def _fetch_image(url: str, client: httpx.AsyncClient) -> Image.Image | None:
    """Download *url* and decode to a PIL Image. Returns None on any error."""
    try:
        resp = await client.get(url, timeout=_HTTP_TIMEOUT, follow_redirects=True)
        resp.raise_for_status()
        raw = resp.content
        if len(raw) > _MAX_DOWNLOAD_BYTES:
            logger.warning("outfit_composite: image too large (%d bytes) url=%s", len(raw), url)
            return None
        return Image.open(io.BytesIO(raw)).convert("RGBA")
    except Exception as exc:
        logger.warning("outfit_composite: failed to fetch %s: %s", url, exc)
        return None


# ---------------------------------------------------------------------------
# Cell renderer
# ---------------------------------------------------------------------------

def _garment_cell(
    img: Image.Image | None,
    label: str,
    cell_w: int,
    cell_h: int,
) -> Image.Image:
    """Render a single garment cell: white-ish background, thumbnail, label below."""
    cell = Image.new("RGBA", (cell_w, cell_h), (255, 255, 255, 255))
    draw = ImageDraw.Draw(cell)

    label_area_h = LABEL_FONT_SIZE + 6
    thumb_area_h = cell_h - label_area_h - 4

    if img is not None:
        # Fit thumbnail into the thumb area, keeping aspect ratio
        img_copy = img.copy()
        img_copy.thumbnail((cell_w - 8, thumb_area_h - 4), Image.Resampling.LANCZOS)
        x = (cell_w - img_copy.width) // 2
        y = (thumb_area_h - img_copy.height) // 2 + 2
        if img_copy.mode == "RGBA":
            cell.paste(img_copy, (x, y), img_copy)
        else:
            cell.paste(img_copy.convert("RGBA"), (x, y))

    # Label
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", LABEL_FONT_SIZE)
    except Exception:
        font = ImageFont.load_default()

    # Truncate if too long
    max_chars = max(1, (cell_w - 8) // (LABEL_FONT_SIZE // 2 + 1))
    display = label[:max_chars] + "…" if len(label) > max_chars else label
    draw.text(
        (cell_w // 2, cell_h - label_area_h // 2 - 2),
        display,
        fill=LABEL_COLOR,
        font=font,
        anchor="mm",
    )

    # Subtle border
    draw.rectangle([0, 0, cell_w - 1, cell_h - 1], outline=(217, 217, 212, 200))

    return cell


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def build_outfit_composite(
    avatar_url: str,
    garment_items: Sequence[dict],   # [{url, name, category}]
    output_w: int = OUTPUT_W,
    output_h: int = OUTPUT_H,
) -> bytes:
    """
    Fetch the avatar portrait and garment images, composite them side-by-side,
    and return JPEG bytes.

    Args:
        avatar_url:     Public URL of the user's stored avatar portrait.
        garment_items:  Ordered list of dicts with keys ``url``, ``name``, ``category``.
                        Items should be sorted outerwear → top → dress → bottom → shoes → accessory.
        output_w:       Output image width in pixels (default 900).
        output_h:       Output image height in pixels (default 300).

    Returns:
        JPEG bytes of the composite image.
    """
    avatar_col_w = int(output_w * 0.42)
    garment_col_w = output_w - avatar_col_w

    async with httpx.AsyncClient() as client:
        # Fetch all images concurrently
        tasks = [_fetch_image(avatar_url, client)]
        for item in garment_items:
            url = (item.get("url") or "").strip()
            tasks.append(_fetch_image(url, client) if url else _none_image())
        results = await asyncio.gather(*tasks, return_exceptions=False)

    avatar_img = results[0] if results else None
    garment_imgs: list[Image.Image | None] = list(results[1:])

    canvas = Image.new("RGB", (output_w, output_h), BG_COLOR)

    # ---------------------------------------------------------------------------
    # Left column — avatar portrait (contain: full illustration, no cropping)
    # ---------------------------------------------------------------------------
    if avatar_img is not None:
        avatar_img_rgb = avatar_img.convert("RGB")
        # Scale to *fit* within the avatar column keeping aspect ratio (no cropping)
        scale = min(avatar_col_w / avatar_img_rgb.width, output_h / avatar_img_rgb.height)
        new_w = int(avatar_img_rgb.width * scale)
        new_h = int(avatar_img_rgb.height * scale)
        avatar_resized = avatar_img_rgb.resize((new_w, new_h), Image.Resampling.LANCZOS)
        # Centre the fitted image inside the column
        x = (avatar_col_w - new_w) // 2
        y = (output_h - new_h) // 2
        canvas.paste(avatar_resized, (x, y))

    # Subtle vertical divider
    draw_canvas = ImageDraw.Draw(canvas)
    draw_canvas.line(
        [(avatar_col_w, GUTTER), (avatar_col_w, output_h - GUTTER)],
        fill=(217, 217, 212),
        width=1,
    )

    # ---------------------------------------------------------------------------
    # Right column — garment grid (2 columns × up to 2 rows = 4 cells max)
    # ---------------------------------------------------------------------------
    n = len(garment_items)
    if n > 0:
        # Always use 2 display columns so each cell is wide enough to show the photo
        cols = 2
        rows = 2 if n > 2 else 1  # 1 row for 1-2 items, 2 rows for 3-4
        if n <= 2:
            cols = n  # spread single row evenly

        cell_w = (garment_col_w - GUTTER * (cols + 1)) // cols
        cell_h = (output_h - GUTTER * (rows + 1)) // rows

        for idx, item in enumerate(garment_items[:cols * rows]):
            col_idx = idx % cols
            row_idx = idx // cols
            cx = avatar_col_w + GUTTER + col_idx * (cell_w + GUTTER)
            cy = GUTTER + row_idx * (cell_h + GUTTER)
            label = (item.get("name") or "").strip()
            cell = _garment_cell(garment_imgs[idx] if idx < len(garment_imgs) else None, label, cell_w, cell_h)
            if cell.mode == "RGBA":
                canvas.paste(cell.convert("RGB"), (cx, cy))
            else:
                canvas.paste(cell, (cx, cy))

    out = io.BytesIO()
    canvas.save(out, format="JPEG", quality=92)
    logger.info(
        "outfit_composite: composite built avatar=%s garments=%d bytes=%d",
        avatar_url[:60],
        n,
        out.tell(),
    )
    return out.getvalue()
