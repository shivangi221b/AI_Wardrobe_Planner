-- Add favorite retail brands for shop query personalization.
-- Run in Supabase SQL editor after user_profiles exists.

alter table public.user_profiles
  add column if not exists favorite_brands text[] default '{}';

comment on column public.user_profiles.favorite_brands is
  'Brands the user wants prioritised in Shop search queries.';
