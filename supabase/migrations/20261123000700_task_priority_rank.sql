-- Numeric priority for ordering tasks (urgent > high > medium > low).
alter table public.tasks
  add column priority_rank smallint generated always as (
    case priority when 'urgent' then 4 when 'high' then 3 when 'medium' then 2 else 1 end
  ) stored;

create index tasks_user_open_priority_idx on public.tasks (user_id, priority_rank desc, due_at)
  where status in ('todo', 'in_progress');
