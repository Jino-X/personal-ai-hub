-- ════════════════════════════════════════════════════════════════════════════
-- AI assistant (conversations, messages, confirmable actions), the durable
-- agent job queue, and daily/weekly briefings.
-- ════════════════════════════════════════════════════════════════════════════

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  title text not null default 'New conversation' check (char_length(title) between 1 and 200),
  model text,
  pinned boolean not null default false,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index conversations_user_recent_idx on public.conversations (user_id, pinned desc, last_message_at desc nulls last);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  role text not null check (role in ('system', 'user', 'assistant', 'tool')),
  content text not null default '',
  thinking text,
  citations jsonb not null default '[]'::jsonb check (jsonb_typeof(citations) = 'array'),
  tool_calls jsonb,
  status text not null default 'complete' check (status in ('streaming', 'complete', 'error')),
  model text,
  error text,
  usage jsonb,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, user_id) references public.conversations (id, user_id) on delete cascade
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- Consequential assistant tool calls are proposed here and only executed after
-- the user explicitly confirms them through the API.
create table public.assistant_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  conversation_id uuid not null,
  message_id uuid references public.messages (id) on delete set null,
  tool text not null,
  arguments jsonb not null default '{}'::jsonb,
  summary text not null,
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'rejected', 'executed', 'failed', 'expired')),
  result jsonb,
  error text,
  expires_at timestamptz not null default now() + interval '1 day',
  decided_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (conversation_id, user_id) references public.conversations (id, user_id) on delete cascade
);
create index assistant_actions_conversation_idx on public.assistant_actions (conversation_id, created_at);

-- ── Agent job queue ─────────────────────────────────────────────────────────
-- Durable, retryable background work. Workers claim jobs with SKIP LOCKED,
-- stale locks are recovered, failures back off exponentially.

create table public.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete cascade,
  agent text not null check (agent in ('research', 'ai_news', 'developer', 'productivity', 'knowledge', 'briefing', 'watchlist', 'system')),
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  priority smallint not null default 5,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  result jsonb,
  dedupe_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index agent_jobs_dedupe_active_idx on public.agent_jobs (dedupe_key)
  where dedupe_key is not null and status in ('queued', 'running');
create index agent_jobs_ready_idx on public.agent_jobs (priority, run_at) where status = 'queued';
create index agent_jobs_running_idx on public.agent_jobs (locked_at) where status = 'running';
create index agent_jobs_user_idx on public.agent_jobs (user_id, created_at desc);
create index agent_jobs_finished_idx on public.agent_jobs (finished_at) where status in ('succeeded', 'failed', 'cancelled');

create or replace function public.enqueue_agent_job(
  p_agent text,
  p_kind text,
  p_payload jsonb default '{}'::jsonb,
  p_user_id uuid default null,
  p_run_at timestamptz default now(),
  p_priority smallint default 5,
  p_max_attempts integer default 5,
  p_dedupe_key text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.agent_jobs (agent, kind, payload, user_id, run_at, priority, max_attempts, dedupe_key)
  values (p_agent, p_kind, coalesce(p_payload, '{}'::jsonb), p_user_id, coalesce(p_run_at, now()), p_priority, p_max_attempts, p_dedupe_key)
  on conflict (dedupe_key) where dedupe_key is not null and status in ('queued', 'running') do nothing
  returning id into v_id;

  if v_id is null and p_dedupe_key is not null then
    select j.id into v_id
      from public.agent_jobs j
     where j.dedupe_key = p_dedupe_key and j.status in ('queued', 'running')
     limit 1;
  end if;
  return v_id;
end;
$$;

create or replace function public.claim_agent_jobs(
  p_worker text,
  p_limit integer default 1,
  p_kinds text[] default null
)
returns setof public.agent_jobs
language sql
set search_path = ''
as $$
  update public.agent_jobs j
     set status = 'running',
         locked_at = now(),
         locked_by = p_worker,
         started_at = now(),
         attempts = j.attempts + 1
   where j.id in (
           select q.id
             from public.agent_jobs q
            where q.status = 'queued'
              and q.run_at <= now()
              and (p_kinds is null or q.kind = any (p_kinds))
            order by q.priority asc, q.run_at asc
            limit greatest(p_limit, 1)
            for update skip locked
         )
  returning j.*;
$$;

-- Re-queue jobs whose worker died mid-run (or fail them once attempts are exhausted).
create or replace function public.recover_stale_agent_jobs(p_timeout interval default interval '15 minutes')
returns integer
language sql
set search_path = ''
as $$
  with stale as (
    update public.agent_jobs j
       set status = case when j.attempts >= j.max_attempts then 'failed' else 'queued' end,
           finished_at = case when j.attempts >= j.max_attempts then now() else null end,
           last_error = coalesce(j.last_error, '') || case when j.last_error is null then '' else E'\n' end
                        || 'Worker lock expired at ' || now()::text,
           run_at = now(),
           locked_at = null,
           locked_by = null
     where j.status = 'running'
       and j.locked_at < now() - p_timeout
    returning 1
  )
  select count(*)::integer from stale;
$$;

revoke execute on function public.enqueue_agent_job(text, text, jsonb, uuid, timestamptz, smallint, integer, text) from public, anon, authenticated;
revoke execute on function public.claim_agent_jobs(text, integer, text[]) from public, anon, authenticated;
revoke execute on function public.recover_stale_agent_jobs(interval) from public, anon, authenticated;

-- ── Briefings ───────────────────────────────────────────────────────────────

create table public.briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  kind text not null check (kind in ('daily', 'weekly')),
  period_start date not null,
  period_end date not null,
  title text not null default '',
  content jsonb not null default '{}'::jsonb, -- structured sections built from stored data
  status text not null default 'pending' check (status in ('pending', 'generating', 'ready', 'failed')),
  ai_status text not null default 'pending' check (ai_status in ('pending', 'processing', 'done', 'failed', 'skipped')),
  model text,
  error text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique (user_id, kind, period_start)
);
create index briefings_user_recent_idx on public.briefings (user_id, kind, period_start desc);

-- ── updated_at triggers & RLS ───────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array['conversations', 'assistant_actions', 'agent_jobs', 'briefings']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_set_updated_at', t);
  end loop;

  foreach t in array array['conversations', 'messages']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
                   t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))',
                   t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
                   t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))',
                   t || '_delete_own', t);
  end loop;
end;
$$;

-- Read-only to clients; the API (service role) proposes, confirms and executes actions.
alter table public.assistant_actions enable row level security;
create policy assistant_actions_select_own on public.assistant_actions for select to authenticated
  using (user_id = (select auth.uid()));

alter table public.agent_jobs enable row level security;
create policy agent_jobs_select_own on public.agent_jobs for select to authenticated
  using (user_id = (select auth.uid()));

alter table public.briefings enable row level security;
create policy briefings_select_own on public.briefings for select to authenticated
  using (user_id = (select auth.uid()));
create policy briefings_delete_own on public.briefings for delete to authenticated
  using (user_id = (select auth.uid()));
