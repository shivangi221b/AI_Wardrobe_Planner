## Onboarding API endpoints (MVP)

This document describes the backend endpoints needed to support the onboarding and wardrobe inventory flows.

Base URL is assumed to be the FastAPI service root.

---

### 1. Create media ingestion job

- **Endpoint**: `POST /media-ingestion`
- **Purpose**: register an uploaded closet video or image batch for background processing.

The actual media upload is expected to happen to an object store (e.g., S3, GCS) using a pre-signed URL or equivalent. The client then calls this endpoint with the storage URI.

#### Request body

```json
{
  "user_id": "user-123",
  "media_type": "video",
  "source_uri": "s3://bucket/path/to/closet.mp4"
}
```

- `media_type`: one of:
  - `"video"`
  - `"image_batch"`

#### Response body

```json
{
  "job_id": "job-uuid",
  "status": "pending"
}
```

The `job_id` is used to poll for status.

---

### 2. Get media ingestion job status

- **Endpoint**: `GET /media-ingestion/{job_id}`
- **Purpose**: allow the client to poll for ingestion status and progress.

#### Path parameters

- `job_id`: the identifier returned by the `POST /media-ingestion` call.

#### Successful response body

```json
{
  "id": "job-uuid",
  "user_id": "user-123",
  "media_type": "video",
  "source_uri": "s3://bucket/path/to/closet.mp4",
  "status": "processing",
  "progress": 0.45,
  "error_message": null,
  "frame_count": 120,
  "detected_items_count": 18,
  "created_at": "2025-01-01T12:00:00Z",
  "updated_at": "2025-01-01T12:00:10Z"
}
```

#### Error responses

- `404 Not Found` if the job does not exist.

---

### 3. Get user wardrobe

- **Endpoint**: `GET /wardrobe/{user_id}`
- **Purpose**: fetch the current set of `GarmentItem`s for a user, for use in the inventory review UI and later outfit recommendation flows.

#### Path parameters

- `user_id`: identifier of the user.

#### Successful response body

An array of garments, for example:

```json
[
  {
    "id": "garment-1",
    "user_id": "user-123",
    "primary_image_url": "https://cdn.example.com/wardrobe/user-123/garment_0001.jpg",
    "alt_image_urls": [],
    "category": "top",
    "sub_category": "t-shirt",
    "color_primary": "red",
    "color_secondary": null,
    "pattern": "solid",
    "formality": "casual",
    "seasonality": "hot",
    "brand": null,
    "size": null,
    "material": null,
    "fit_notes": null,
    "embedding_id": "embed-xyz",
    "created_at": "2025-01-01T12:00:00Z",
    "updated_at": "2025-01-01T12:00:00Z"
  }
]
```

---

### 4. Future extensions (not implemented yet)

These are not required for the first onboarding milestone but are natural next steps:

- `POST /wardrobe/{user_id}`: create `GarmentItem`s manually or from guided capture.
- `PATCH /wardrobe/{user_id}/{garment_id}`: edit attributes such as category, colors, seasonality, formality.
- `DELETE /wardrobe/{user_id}/{garment_id}`: delete an item.

