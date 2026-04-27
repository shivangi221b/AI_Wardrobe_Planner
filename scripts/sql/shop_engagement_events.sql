-- Append-only shop funnel events (impression, click, dismiss, add_to_wardrobe).
-- Run in Supabase SQL editor. Enable RLS and add policies so each user_id
-- can only insert/select own rows if clients use the anon key; with service
-- role (backend only), RLS can remain disabled.

create table if not exists public.shop_engagement_events (
  id          bigserial primary key,
  user_id     text not null,
  gap_id      text not null,
  event_type  text not null,
  product_id  text,
  created_at  timestamptz not null default now()
);

create index if not exists shop_engagement_events_user_id_created_at_idx
  on public.shop_engagement_events (user_id, created_at desc);

comment on table public.shop_engagement_events is
  'Shop feature analytics: views, outbound clicks, dismissals, add-to-wardrobe.';

-- Example RLS (optional; adjust to your auth model):
-- alter table public.shop_engagement_events enable row level security;
-- create policy "Users insert own shop events"
--   on public.shop_engagement_events for insert with check (auth.uid()::text = user_id);
