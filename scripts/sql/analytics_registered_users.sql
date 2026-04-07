-- Run once in Supabase: Dashboard → SQL → New query → Run.
-- Lets POST /analytics/register count OAuth logins in GET /api/metrics (signups).
-- Also backfills existing users from public.garments so historical data is included.

create table if not exists public.analytics_registered_users (
  user_id text primary key,
  first_seen timestamptz not null default now()
);

insert into public.analytics_registered_users (user_id)
select distinct g.user_id
from public.garments g
where g.user_id is not null
on conflict (user_id) do nothing;

comment on table public.analytics_registered_users is
  'Idempotent signup registry for metrics; written by backend POST /analytics/register.';
