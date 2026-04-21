-- Extended user profile: style preferences, sizes, color tone, and avatar config.
-- Run in Supabase SQL editor once (after app_users.sql is applied).

create table if not exists public.user_profiles (
  user_id         text primary key,
  gender          text,
  birthday        text,
  skin_tone       text,
  color_tone      text,     -- 'warm' | 'cool' | 'neutral'
  favorite_colors text[],   -- array of colour names / hex codes chosen by user
  avoided_colors  text[],   -- array of colour names / hex codes the user wants excluded
  shoe_size       text,
  top_size        text,
  bottom_size     text,
  avatar_config   jsonb,    -- {hair_style, hair_color, body_type, skin_tone}
  updated_at      timestamptz not null default now()
);

comment on table public.user_profiles is
  'Extended style profile: measurements are in user_measurements; identity in app_users.';

comment on column public.user_profiles.color_tone is
  'Broad colour temperature preference: warm, cool, or neutral.';

comment on column public.user_profiles.favorite_colors is
  'Colours the user wants to see prioritised in recommendations.';

comment on column public.user_profiles.avoided_colors is
  'Colours the user wants de-prioritised or excluded from recommendations.';

comment on column public.user_profiles.avatar_config is
  'JSON blob for the Bitmoji-style avatar: hair_style, hair_color, body_type, skin_tone.';
