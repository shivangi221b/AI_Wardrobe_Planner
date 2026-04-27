-- Tracks the outfit variant users selected (original vs regenerated).
create table if not exists public.recommendation_choice_events (
  id bigserial primary key,
  user_id text not null,
  day text not null,
  chosen_variant_id text not null,
  source_type text not null,
  pin_whole_outfit boolean not null default false,
  pinned_piece_keys jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists recommendation_choice_events_user_id_idx
  on public.recommendation_choice_events (user_id);
