-- Adds times_recommended column to garments (if missing) and creates an atomic
-- increment RPC used by the recommendations engine.
-- Run once in Supabase: Dashboard → SQL Editor → New query → Run.
-- Safe to re-run (IF NOT EXISTS / CREATE OR REPLACE are idempotent).

-- 1. Add the column if it does not exist yet.
ALTER TABLE public.garments
    ADD COLUMN IF NOT EXISTS times_recommended integer NOT NULL DEFAULT 0;

-- 2. Create (or replace) the atomic increment function.
CREATE OR REPLACE FUNCTION public.increment_garment_recommended(
    garment_id  text,
    delta       integer DEFAULT 1
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.garments
    SET    times_recommended = COALESCE(times_recommended, 0) + delta,
           updated_at        = now()
    WHERE  id = garment_id;
$$;

-- 3. Grant execute to the roles used by the Supabase client.
GRANT EXECUTE ON FUNCTION public.increment_garment_recommended(text, integer)
    TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.increment_garment_recommended IS
    'Atomically increments times_recommended for a garment row. '
    'Called by the recommendations engine after a weekly plan is generated.';
