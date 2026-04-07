-- Run once in Supabase: Dashboard → SQL → New query → Run.
-- Lets POST /analytics/register count OAuth logins in GET /api/metrics (signups).

create table if not exists public.analytics_registered_users (
  user_id text primary key,
  first_seen timestamptz not null default now()
);

comment on table public.analytics_registered_users is
  'Idempotent signup registry for metrics; written by backend POST /analytics/register.';
