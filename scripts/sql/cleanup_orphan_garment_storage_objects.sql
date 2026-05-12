-- -----------------------------------------------------------------------------
-- PREVIEW ONLY — orphan garment objects in Storage
-- -----------------------------------------------------------------------------
-- Supabase enables ``storage.protect_delete()`` so you **cannot** run
-- ``DELETE FROM storage.objects`` from the SQL Editor (error 42501).
--
-- To actually remove orphans, run locally from the repo root:
--
--   python3 scripts/cleanup_orphan_garment_storage.py
--   python3 scripts/cleanup_orphan_garment_storage.py --execute
--
-- Requires ``SUPABASE_URL`` and ``SUPABASE_SERVICE_KEY`` (e.g. from ``.env``).
-- -----------------------------------------------------------------------------
--
-- The query below is **read-only**: lists rows in ``storage.objects`` that
-- have no matching URL in ``public.garments``. If your project still allows
-- this SELECT, use it to sanity-check paths before running the Python script.
-- -----------------------------------------------------------------------------


-- =============================================================================
-- PREVIEW (read-only) — may be restricted on some Supabase tiers; if it fails,
-- rely on the Python script which uses the Storage + PostgREST APIs instead.
-- =============================================================================
WITH bucket AS (
  SELECT id
  FROM storage.buckets
  WHERE name = 'garments' /* <-- change if your bucket name differs */
  LIMIT 1
),
garment_references AS (
  SELECT g.primary_image_url::text AS url
  FROM public.garments g
  WHERE g.primary_image_url IS NOT NULL
  UNION ALL
  SELECT elem::text AS url
  FROM public.garments g
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN g.alt_image_urls IS NULL THEN '[]'::jsonb
      WHEN jsonb_typeof(g.alt_image_urls::jsonb) = 'array' THEN g.alt_image_urls::jsonb
      ELSE '[]'::jsonb
    END
  ) AS elem
),
orphan_objects AS (
  SELECT
    o.id AS object_id,
    o.name AS object_path,
    o.created_at
  FROM storage.objects o
  CROSS JOIN bucket b
  WHERE o.bucket_id = b.id
    AND length(trim(o.name)) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM garment_references r
      WHERE r.url IS NOT NULL
        AND length(trim(r.url)) > 0
        AND strpos(r.url, o.name) > 0
    )
)
SELECT object_id, object_path, created_at
FROM orphan_objects
ORDER BY created_at;


-- (Removed SQL DELETE section: use scripts/cleanup_orphan_garment_storage.py --execute.)


-- =============================================================================
-- SECTION C — If alt_image_urls is text[], replace the UNION ALL alt branch with:
-- =============================================================================
--
--   UNION ALL
--   SELECT u AS url
--   FROM public.garments g
--   CROSS JOIN LATERAL unnest(coalesce(g.alt_image_urls, array[]::text[])) AS u
--
-- and remove jsonb_array_elements_text / ::jsonb from alt handling in both CTEs.
-- =============================================================================
