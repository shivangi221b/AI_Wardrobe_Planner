from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import List, Optional

import cv2
import numpy as np
from sklearn.cluster import AgglomerativeClustering
from ultralytics import YOLO


@dataclass
class DetectedGarment:
    """
    Lightweight representation of a detected garment produced by the vision
    pipeline. This mirrors the GarmentItem model at a high level but is
    independent of any web framework.
    """

    id: str
    primary_image_path: str
    category: Optional[str] = None
    sub_category: Optional[str] = None
    color_primary: Optional[str] = None
    color_secondary: Optional[str] = None
    pattern: Optional[str] = None
    formality: Optional[str] = None
    seasonality: Optional[str] = None
    embedding: Optional[List[float]] = None


_YOLO_MODEL: YOLO | None = None


def _get_yolo_model() -> YOLO:
    """
    Lazily load the DeepFashion2 YOLOv8s segmentation model.

    Expects weights at vision/models/deepfashion2_yolov8s-seg.pt relative to
    the project root. We only touch files inside the project directory so
    nothing is installed system-wide.
    """
    global _YOLO_MODEL
    if _YOLO_MODEL is None:
        weights_path = Path(__file__).resolve().parent / "models" / "deepfashion2_yolov8s-seg.pt"
        _YOLO_MODEL = YOLO(str(weights_path))
    return _YOLO_MODEL


def sample_frames_from_video(video_path: str, fps: float = 2.0) -> List[np.ndarray]:
    """
    Sample frames from a video at a target FPS.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")

    native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(int(native_fps // fps), 1)

    frames: List[np.ndarray] = []
    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % step == 0:
            frames.append(frame)
        frame_idx += 1

    cap.release()
    return frames


def detect_and_segment_garments(frames: List[np.ndarray]) -> List[np.ndarray]:
    """
    Run YOLOv8 clothing detection and return per-garment crops with background
    removed (simple white backdrop).

    If no boxes are found at all, we fall back to returning the original frames.
    """
    if not frames:
        return []

    model = _get_yolo_model()
    results = model(frames, verbose=False)

    crops: List[np.ndarray] = []
    for frame, result in zip(frames, results):
        h, w, _ = frame.shape

        if not hasattr(result, "boxes") or result.boxes is None:
            continue

        # Prefer using segmentation masks when available for tighter isolation.
        masks = getattr(result, "masks", None)

        for idx, box in enumerate(result.boxes):
            xyxy = box.xyxy[0].cpu().numpy()
            x1, y1, x2, y2 = [int(v) for v in xyxy]

            x1 = max(0, min(x1, w - 1))
            x2 = max(0, min(x2, w))
            y1 = max(0, min(y1, h - 1))
            y2 = max(0, min(y2, h))

            if x2 <= x1 or y2 <= y1:
                continue

            # Skip extremely small boxes (<1% of image area).
            if (x2 - x1) * (y2 - y1) < 0.01 * w * h:
                continue

            crop = frame[y1:y2, x1:x2].copy()

            if masks is not None and masks.data is not None and idx < len(masks.data):
                # masks.data is (N, H, W) in model space; resize to frame size.
                mask_full = masks.data[idx].cpu().numpy()
                mask_full = cv2.resize(mask_full, (w, h), interpolation=cv2.INTER_NEAREST)
                mask_roi = mask_full[y1:y2, x1:x2]

                # Create white background and composite garment where mask > 0.5.
                white_bg = np.ones_like(crop) * 255
                garment_region = crop.copy()
                binary_mask = mask_roi > 0.5
                white_bg[binary_mask] = garment_region[binary_mask]
                crop = white_bg

            crops.append(crop)

    if not crops:
        return frames

    return crops


def compute_embeddings(images: List[np.ndarray]) -> np.ndarray:
    """
    Placeholder for CLIP / open_clip embeddings.

    In a full implementation, this would:
    - Load an open_clip ViT-B/32 model.
    - Preprocess each image.
    - Return an array of shape (n_images, embedding_dim).
    """
    # Stub: random embeddings for development-time plumbing.
    rng = np.random.default_rng(seed=42)
    return rng.normal(size=(len(images), 32)).astype(np.float32)


def deduplicate_embeddings(embeddings: np.ndarray, distance_threshold: float = 0.3) -> List[int]:
    """
    Cluster embeddings to find near-duplicates. Returns a representative index
    for each cluster.
    """
    n_samples = len(embeddings)
    if n_samples == 0:
        return []
    if n_samples == 1:
        # Nothing to cluster; the single sample is its own representative.
        return [0]

    # Normalize for cosine distance.
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True) + 1e-8
    normalized = embeddings / norms

    clustering = AgglomerativeClustering(
        n_clusters=None,
        metric="cosine",
        distance_threshold=distance_threshold,
        linkage="average",
    )
    labels = clustering.fit_predict(normalized)

    representatives: List[int] = []
    for label in np.unique(labels):
        idxs = np.where(labels == label)[0]
        representatives.append(int(idxs[0]))
    return representatives


def save_thumbnails(images: List[np.ndarray], output_dir: Path) -> List[str]:
    """
    Save thumbnails to disk and return their relative paths.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    paths: List[str] = []
    for i, img in enumerate(images):
        filename = f"garment_{i:04d}.jpg"
        path = output_dir / filename
        cv2.imwrite(str(path), img)
        paths.append(filename)
    return paths


def process_video_to_inventory(video_path: str, output_dir: str) -> List[DetectedGarment]:
    """
    End-to-end prototype: given a closet video, produce thumbnails and a JSON
    listing of detected garments.
    """
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    frames = sample_frames_from_video(video_path)
    garment_crops = detect_and_segment_garments(frames)
    embeddings = compute_embeddings(garment_crops)

    rep_indices = deduplicate_embeddings(embeddings)
    thumb_paths = save_thumbnails(garment_crops, out_dir)

    garments: List[DetectedGarment] = []
    for idx in rep_indices:
        garment = DetectedGarment(
            id=f"garment-{idx}",
            primary_image_path=thumb_paths[idx],
            embedding=embeddings[idx].tolist(),
        )
        garments.append(garment)

    json_path = out_dir / "inventory.json"
    with json_path.open("w", encoding="utf-8") as f:
        json.dump([asdict(g) for g in garments], f, indent=2)

    return garments


def process_images_to_inventory(image_paths: List[str], output_dir: str) -> List[DetectedGarment]:
    """
    Similar to process_video_to_inventory but for a batch of still images.
    """
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    images: List[np.ndarray] = []
    for path in image_paths:
        img = cv2.imread(path)
        if img is None:
            continue
        images.append(img)

    garment_crops = detect_and_segment_garments(images)
    embeddings = compute_embeddings(garment_crops)

    rep_indices = deduplicate_embeddings(embeddings)
    thumb_paths = save_thumbnails(garment_crops, out_dir)

    garments: List[DetectedGarment] = []
    for idx in rep_indices:
        garment = DetectedGarment(
            id=f"garment-{idx}",
            primary_image_path=thumb_paths[idx],
            embedding=embeddings[idx].tolist(),
        )
        garments.append(garment)

    json_path = out_dir / "inventory.json"
    with json_path.open("w", encoding="utf-8") as f:
        json.dump([asdict(g) for g in garments], f, indent=2)

    return garments


def _main() -> None:
    """
    Minimal CLI for local experimentation.
    """
    import argparse

    parser = argparse.ArgumentParser(description="Prototype wardrobe inventory extraction.")
    parser.add_argument("--video", type=str, help="Path to closet video.", default=None)
    parser.add_argument(
        "--images",
        type=str,
        nargs="*",
        help="Paths to closet images.",
        default=None,
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        required=True,
        help="Directory to write thumbnails and inventory.json.",
    )

    args = parser.parse_args()

    if not args.video and not args.images:
        raise SystemExit("Specify either --video or --images.")

    os.makedirs(args.output_dir, exist_ok=True)

    if args.video:
        process_video_to_inventory(args.video, args.output_dir)
    else:
        assert args.images is not None
        process_images_to_inventory(args.images, args.output_dir)


if __name__ == "__main__":
    _main()

