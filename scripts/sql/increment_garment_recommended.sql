-- Adds times_recommended column to garments (if missing) and creates an atomic
-- increment RPC used by the recommendations engine.
-- Run once in Supabase: Dashboard → SQL Editor → New query → Run.
-- Safe to re-run (IF NOT EXISTS / CREATE OR REPLACE are idempotent).

-- 1. Add the column if it does not exist yet.
ALTER TABLE public.garments
    ADD COLUMN IF NOT EXISTS times_recommended integer NOT NULL DEFAULT 0;

-- 2. Create (or replace) the atomic increment function.
--    SECURITY DEFINER is intentional so the backend service_role can bypass RLS,
--    but EXECUTE is restricted to service_role only (see GRANT below) so that
--    anon/authenticated clients cannot invoke it directly.
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

-- 3. Restrict execute to service_role only.
--    The backend calls this function via the service-role key, so anon and
--    authenticated roles do not need direct access.  Revoking those roles
--    prevents clients from incrementing arbitrary garment rows by guessing IDs.
REVOKE EXECUTE ON FUNCTION public.increment_garment_recommended(text, integer)
    FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.increment_garment_recommended(text, integer)
    TO service_role;

COMMENT ON FUNCTION public.increment_garment_recommended(text, integer) IS
    'Atomically increments times_recommended for a garment row. '
    'Called by the recommendations engine after a weekly plan is generated. '
    'EXECUTE is restricted to service_role to prevent unauthorised increments.';
