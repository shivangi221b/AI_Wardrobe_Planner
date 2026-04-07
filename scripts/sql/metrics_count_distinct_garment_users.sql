-- Run once in Supabase: SQL Editor → New query → Run.
-- Server-side COUNT(DISTINCT user_id) for GET /api/metrics (signups) without loading all rows.
-- Default table is public.garments. If you use SUPABASE_GARMENTS_TABLE=other, either duplicate
-- this function for that table or set SUPABASE_GARMENTS_DISTINCT_USERS_RPC to your RPC name.

create or replace function public.metrics_count_distinct_garment_users()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(count(distinct user_id)::bigint, 0)
  from public.garments
  where user_id is not null;
$$;

revoke all on function public.metrics_count_distinct_garment_users() from public;
grant execute on function public.metrics_count_distinct_garment_users() to service_role;

comment on function public.metrics_count_distinct_garment_users() is
  'Metrics: distinct wardrobe users; called by backend via Supabase RPC.';
