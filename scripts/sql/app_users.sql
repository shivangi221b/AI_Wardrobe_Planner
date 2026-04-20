-- Email + password accounts for the mobile app (server verifies credentials; not Supabase Auth).
-- Run in Supabase SQL editor once.

create table if not exists public.app_users (
  user_id text primary key,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_users_email_lower_idx on public.app_users (lower(email));

comment on table public.app_users is
  'Email/password signups; user_id matches app wardrobe API key (email-… slug).';
