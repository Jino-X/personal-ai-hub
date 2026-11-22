-- ════════════════════════════════════════════════════════════════════════════
-- Productivity: goals, milestones, projects, tasks, skills, learning resources,
-- calendar events.
--
-- Cross-table references use composite (id, user_id) foreign keys so a row can
-- never point at another user's goal/project — enforced by the database itself,
-- independent of RLS.
-- ════════════════════════════════════════════════════════════════════════════

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text,
  type text not null default 'personal' check (type in ('personal', 'career', 'learning', 'health', 'project')),
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  target_date date,
  progress smallint not null default 0 check (progress between 0 and 100),
  color text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index goals_user_status_idx on public.goals (user_id, status);

create table public.goal_milestones (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null,
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text,
  kind text not null default 'milestone' check (kind in ('milestone', 'lesson')),
  target_value numeric check (target_value is null or target_value > 0),
  current_value numeric not null default 0 check (current_value >= 0),
  unit text,
  due_date date,
  completed_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete cascade
);
create index goal_milestones_goal_idx on public.goal_milestones (goal_id, sort_order);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  description text,
  color text not null default 'slate',
  status text not null default 'active' check (status in ('active', 'on_hold', 'completed', 'archived')),
  goal_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete set null (goal_id)
);
create index projects_user_idx on public.projects (user_id, status);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  project_id uuid,
  goal_id uuid,
  title text not null check (char_length(title) between 1 and 500),
  description text,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'cancelled')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  category text check (char_length(category) <= 60),
  tags text[] not null default '{}',
  due_at timestamptz,
  remind_at timestamptz,
  reminder_sent_at timestamptz,
  recurrence jsonb check (recurrence is null or jsonb_typeof(recurrence) = 'object'),
  recurrence_parent_id uuid references public.tasks (id) on delete set null,
  completed_at timestamptz,
  sort_order double precision not null default 0,
  source text not null default 'user' check (source in ('user', 'assistant', 'recurrence', 'briefing')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete set null (project_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete set null (goal_id)
);
create index tasks_user_status_due_idx on public.tasks (user_id, status, due_at);
create index tasks_user_completed_idx on public.tasks (user_id, completed_at desc) where completed_at is not null;
create index tasks_project_idx on public.tasks (project_id) where project_id is not null;
create index tasks_goal_idx on public.tasks (goal_id) where goal_id is not null;
create index tasks_tags_idx on public.tasks using gin (tags);
create index tasks_due_reminders_idx on public.tasks (remind_at)
  where remind_at is not null and reminder_sent_at is null and status in ('todo', 'in_progress');

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  category text,
  level smallint not null default 0 check (level between 0 and 5),
  target_level smallint not null default 3 check (target_level between 0 and 5),
  notes text,
  last_practiced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index skills_user_name_idx on public.skills (user_id, lower(name));

create table public.learning_resources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  goal_id uuid,
  title text not null check (char_length(title) between 1 and 300),
  url text,
  kind text not null default 'article' check (kind in ('article', 'video', 'course', 'book', 'documentation', 'repository', 'other')),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete set null (goal_id)
);
create index learning_resources_user_idx on public.learning_resources (user_id, status);
create index learning_resources_goal_idx on public.learning_resources (goal_id) where goal_id is not null;

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  integration_id uuid,
  source text not null default 'local' check (source in ('local', 'google')),
  external_id text,
  calendar_id text,
  title text not null check (char_length(title) between 1 and 300),
  description text,
  location text,
  url text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at),
  unique (user_id, source, external_id),
  foreign key (integration_id, user_id) references public.connected_integrations (id, user_id) on delete cascade
);
create index calendar_events_user_start_idx on public.calendar_events (user_id, starts_at);

-- ── Goal progress maintenance ───────────────────────────────────────────────
-- Progress = average milestone completion; measurable milestones contribute
-- partially (current_value / target_value).

create or replace function public.refresh_goal_progress()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_goal uuid;
begin
  if tg_op = 'DELETE' then
    v_goal := old.goal_id;
  else
    v_goal := new.goal_id;
  end if;

  update public.goals g
     set progress = coalesce((
           select round(100 * avg(
                    case
                      when m.completed_at is not null then 1.0
                      when m.target_value is not null and m.target_value > 0
                        then least(m.current_value / m.target_value, 1.0)
                      else 0.0
                    end))
             from public.goal_milestones m
            where m.goal_id = v_goal), 0)
   where g.id = v_goal;
  return null;
end;
$$;

create trigger goal_milestones_refresh_progress
  after insert or update or delete on public.goal_milestones
  for each row execute function public.refresh_goal_progress();

-- ── updated_at triggers & RLS ───────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array['goals', 'goal_milestones', 'projects', 'tasks', 'skills', 'learning_resources', 'calendar_events']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_set_updated_at', t);
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
