## Vision stack selection (MVP)

This document specifies the concrete models and hosting strategy for the onboarding / wardrobe inventory pipeline.

### 1. Detection and segmentation

- **Object detection**
  - **Model**: Ultralytics **YOLOv8s**.
  - **Use**:
    - Detect clothing items in closet frames (videos) and photos.
    - Provide coarse category labels (top, bottom, dress, outerwear, shoes, accessory).
  - **Checkpoint**:
    - Start with the official COCO-pretrained `yolov8s.pt`.
    - Plan a fine-tuned checkpoint on fashion datasets (DeepFashion2 / ModaNet) later as we collect data.

- **Instance segmentation**
  - **Model**: **EfficientSAM** (lightweight Segment Anything variant).
  - **Use**:
    - Given YOLOv8 bounding boxes, generate per-garment masks.
    - Produce clean cutouts for thumbnails and background removal.
  - **Checkpoint**:
    - Use the public EfficientSAM weights suitable for 512–1024 px inputs.

### 2. Embeddings and attribute tagging

- **Image-text embeddings**
  - **Model**: **open_clip** ViT-B/32.
  - **Use**:
    - Compute an embedding for each cropped garment image.
    - Support:
      - Deduplication and similarity search.
      - Attribute tagging via text prompts (color, pattern, style).

- **Attribute tagging strategy**
  - **Coarse attributes**:
    - Category from YOLOv8 prediction.
  - **Fine-grained attributes**:
    - Use CLIP-style text prompts such as:
      - Colors: \"a photo of a red shirt\", \"a photo of black jeans\", etc.
      - Patterns: \"solid\", \"striped\", \"plaid\", \"floral\", \"graphic\".
      - Formality/seasonality: short prompt sets like \"casual t-shirt\", \"business shirt\", \"winter coat\", etc.
    - Select the most similar prompt per attribute group.

### 3. Deduplication

- **Approach**
  - Compute CLIP embeddings for all garments within a user’s closet.
  - Use cosine similarity + clustering to group near-duplicates.
  - Suggested initial implementation:
    - `AgglomerativeClustering` (scikit-learn) with cosine distance.
    - Minimum cluster size of 1–2; items in the same cluster are treated as potential duplicates.

### 4. Background removal and thumbnails

- **Closet videos / multi-item frames**
  - Use YOLOv8 + EfficientSAM to isolate each garment and composite onto a plain background for thumbnails.

- **Guided single-item photos**
  - Use a dedicated background-removal library (e.g., `rembg` with U²Net/IS-Net).
  - This gives fast, high-quality cutouts when the user follows capture instructions.

### 5. Hosting strategy

- **Phase 1 MVP**
  - Host all models in a single **GPU worker** service:
    - Environment: Python, PyTorch, Ultralytics YOLOv8, EfficientSAM, open_clip, OpenCV.
    - Hardware: 1× NVIDIA T4/L4-class GPU in a single region.
  - The backend creates `MediaIngestionJob` records; the worker consumes them from a job queue and:
    - Downloads the media from object storage.
    - Runs detection, segmentation, embeddings, and attribute tagging.
    - Writes `GarmentItem` records and updates job progress.

- **Later**
  - Optionally split into separate microservices (detection/segmentation vs. embeddings/search) or add on-device variants for privacy-critical users.

