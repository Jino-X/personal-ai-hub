-- ════════════════════════════════════════════════════════════════════════════
-- Personal AI Hub — foundation: extensions, helpers, users, preferences,
-- notifications, audit logs, integrations and local AI devices.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ── Helpers ─────────────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Immutable wrapper so text arrays can be used in generated tsvector columns.
create or replace function public.immutable_array_to_string(arr text[], sep text default ' ')
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(pg_catalog.array_to_string(arr, sep), '');
$$;

-- Case-insensitive whole-word match used by feed ranking and watchlist matching.
create or replace function public.term_matches(haystack text, term text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when term is null or pg_catalog.length(pg_catalog.btrim(term)) < 2 then false
    else haystack operator(pg_catalog.~*) (
      '(^|[^[:alnum:]])'
      || pg_catalog.regexp_replace(pg_catalog.btrim(term), '([.^$*+?()\[\]{}|\\/-])', '\\\1', 'g')
      || '($|[^[:alnum:]])'
    )
  end;
$$;

-- ── Users ───────────────────────────────────────────────────────────────────

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text check (char_length(display_name) <= 80),
  avatar_url text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.users is 'Application profile for each Supabase auth user.';

create table public.user_preferences (
  user_id uuid primary key references public.users (id) on delete cascade,
  theme text not null default 'dark' check (theme in ('dark', 'light', 'system')),
  dashboard_widgets jsonb not null default '[]'::jsonb check (jsonb_typeof(dashboard_widgets) = 'array'),
  interest_categories text[] not null default '{}',
  interest_keywords text[] not null default '{}',
  muted_source_ids uuid[] not null default '{}',
  ai_settings jsonb not null default '{}'::jsonb check (jsonb_typeof(ai_settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notification_preferences (
  user_id uuid primary key references public.users (id) on delete cascade,
  daily_briefing_enabled boolean not null default true,
  daily_briefing_time time not null default '07:00',
  weekly_briefing_enabled boolean not null default true,
  weekly_briefing_day smallint not null default 1 check (weekly_briefing_day between 0 and 6),
  task_reminders_enabled boolean not null default true,
  watchlist_alerts_enabled boolean not null default true,
  min_alert_relevance smallint not null default 50 check (min_alert_relevance between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  kind text not null check (kind in ('task_reminder', 'watchlist_match', 'briefing_ready', 'device', 'system')),
  title text not null check (char_length(title) <= 300),
  body text,
  link text,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_unread_idx on public.notifications (user_id, created_at desc) where read_at is null;
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);

-- Append-only audit trail for sensitive actions. Written only by the API (service role).
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete cascade,
  actor text not null check (actor in ('user', 'assistant', 'system', 'device')),
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index audit_logs_user_created_idx on public.audit_logs (user_id, created_at desc);

-- ── Integrations ────────────────────────────────────────────────────────────

create table public.connected_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  provider text not null check (provider in ('google_calendar', 'github', 'huggingface', 'product_hunt')),
  status text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  account_label text,
  scopes text[] not null default '{}',
  config jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider),
  unique (id, user_id)
);

-- Encrypted OAuth tokens (AES-256-GCM, key held only by the API). Never readable by clients.
create table public.integration_credentials (
  integration_id uuid primary key references public.connected_integrations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  ciphertext text not null,
  key_version smallint not null default 1,
  updated_at timestamptz not null default now()
);

-- ── Local AI devices (companion) ────────────────────────────────────────────

create table public.local_ai_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  platform text,
  companion_version text,
  status text not null default 'active' check (status in ('active', 'revoked')),
  last_seen_at timestamptz,
  last_connected_at timestamptz,
  health jsonb not null default '{}'::jsonb,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index local_ai_devices_user_idx on public.local_ai_devices (user_id, status);

-- Hashed rotating refresh tokens. Never readable by clients.
create table public.device_credentials (
  device_id uuid primary key references public.local_ai_devices (id) on delete cascade,
  refresh_token_hash text not null,
  previous_token_hash text,
  expires_at timestamptz not null,
  rotated_at timestamptz not null default now()
);
create index device_credentials_prev_hash_idx on public.device_credentials (previous_token_hash);

-- Short-lived one-time pairing codes (hashed). Never readable by clients.
create table public.device_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  device_id uuid references public.local_ai_devices (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ── updated_at triggers ─────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array['users', 'user_preferences', 'notification_preferences', 'connected_integrations',
                           'integration_credentials', 'local_ai_devices']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_set_updated_at', t);
  end loop;
end;
$$;

-- ── Row Level Security ──────────────────────────────────────────────────────

alter table public.users enable row level security;
create policy users_select_own on public.users for select to authenticated using (id = (select auth.uid()));
create policy users_update_own on public.users for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

alter table public.user_preferences enable row level security;
create policy user_preferences_select_own on public.user_preferences for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_preferences_update_own on public.user_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.notification_preferences enable row level security;
create policy notification_preferences_select_own on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()));
create policy notification_preferences_update_own on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete_own on public.notifications for delete to authenticated using (user_id = (select auth.uid()));

alter table public.audit_logs enable row level security;
create policy audit_logs_select_own on public.audit_logs for select to authenticated using (user_id = (select auth.uid()));

alter table public.connected_integrations enable row level security;
create policy connected_integrations_select_own on public.connected_integrations for select to authenticated
  using (user_id = (select auth.uid()));

alter table public.local_ai_devices enable row level security;
create policy local_ai_devices_select_own on public.local_ai_devices for select to authenticated
  using (user_id = (select auth.uid()));

-- Secret-bearing tables: RLS on, no policies, and no table privileges for client roles.
alter table public.integration_credentials enable row level security;
alter table public.device_credentials enable row level security;
alter table public.device_pairing_codes enable row level security;
revoke all on table public.integration_credentials, public.device_credentials, public.device_pairing_codes
  from anon, authenticated;
revoke all on table public.audit_logs from anon;
revoke insert, update, delete on table public.audit_logs from authenticated;

-- ── New user bootstrap ──────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)), 80),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id) values (new.id) on conflict (user_id) do nothing;
  insert into public.notification_preferences (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
