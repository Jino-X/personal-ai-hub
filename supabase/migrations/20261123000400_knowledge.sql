-- ════════════════════════════════════════════════════════════════════════════
-- Knowledge vault: folders, documents, embedded chunks (pgvector) and hybrid
-- (full-text + semantic) retrieval with reciprocal rank fusion.
-- ════════════════════════════════════════════════════════════════════════════

create table public.knowledge_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  parent_id uuid,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (parent_id, user_id) references public.knowledge_folders (id, user_id) on delete cascade
);
create index knowledge_folders_user_idx on public.knowledge_folders (user_id);

create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  folder_id uuid,
  type text not null default 'note' check (type in ('article', 'repository', 'paper', 'url', 'note', 'documentation', 'ai_summary')),
  title text not null check (char_length(title) between 1 and 300),
  url text,
  source_item_id uuid references public.intelligence_items (id) on delete set null,
  content text check (char_length(content) <= 500000),
  excerpt text,
  ai_summary text,
  auto_category text,
  tags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  content_hash text,
  index_status text not null default 'pending' check (index_status in ('pending', 'processing', 'indexed', 'failed')),
  index_error text,
  indexed_at timestamptz,
  embedding_model text,
  chunk_count integer not null default 0,
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('english', public.immutable_array_to_string(tags)), 'B')
    || setweight(to_tsvector('english', coalesce(ai_summary, '')), 'B')
    || setweight(to_tsvector('english', left(coalesce(content, ''), 100000)), 'C')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (folder_id, user_id) references public.knowledge_folders (id, user_id) on delete set null (folder_id)
);
create index knowledge_documents_user_created_idx on public.knowledge_documents (user_id, created_at desc);
create index knowledge_documents_folder_idx on public.knowledge_documents (folder_id) where folder_id is not null;
create index knowledge_documents_index_status_idx on public.knowledge_documents (index_status, updated_at)
  where index_status in ('pending', 'failed');
create index knowledge_documents_search_idx on public.knowledge_documents using gin (search);
create index knowledge_documents_tags_idx on public.knowledge_documents using gin (tags);
create unique index knowledge_documents_user_url_idx on public.knowledge_documents (user_id, url) where url is not null;

create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  user_id uuid not null references public.users (id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  token_estimate integer,
  embedding extensions.vector(1024),
  embedding_model text,
  search tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index),
  foreign key (document_id, user_id) references public.knowledge_documents (id, user_id) on delete cascade
);
create index knowledge_chunks_user_idx on public.knowledge_chunks (user_id);
create index knowledge_chunks_search_idx on public.knowledge_chunks using gin (search);
create index knowledge_chunks_embedding_idx on public.knowledge_chunks
  using hnsw (embedding extensions.vector_cosine_ops) with (m = 16, ef_construction = 64);

do $$
declare
  t text;
begin
  foreach t in array array['knowledge_folders', 'knowledge_documents']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_set_updated_at', t);
  end loop;

  foreach t in array array['knowledge_folders', 'knowledge_documents', 'knowledge_chunks']
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

-- ── Hybrid retrieval ────────────────────────────────────────────────────────
-- Reciprocal Rank Fusion of full-text (ts_rank_cd) and semantic (cosine) ranks.
-- Security invoker + explicit auth.uid() filter: callers only ever see their own chunks.
-- Pass p_query_embedding = null for full-text only; p_full_text_weight = 0 for semantic only.

create or replace function public.match_knowledge(
  p_query_text text,
  p_query_embedding extensions.vector(1024) default null,
  p_match_count integer default 8,
  p_full_text_weight real default 1.0,
  p_semantic_weight real default 1.0,
  p_rrf_k integer default 50,
  p_folder_id uuid default null
)
returns table (
  chunk_id uuid,
  document_id uuid,
  chunk_index integer,
  content text,
  title text,
  url text,
  doc_type text,
  score real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with params as (
    select least(greatest(p_match_count, 1), 30) as n, websearch_to_tsquery('english', coalesce(p_query_text, '')) as q
  ),
  scoped as (
    select c.id, c.search, c.embedding
      from public.knowledge_chunks c
      join public.knowledge_documents d on d.id = c.document_id
     where c.user_id = auth.uid()
       and (p_folder_id is null or d.folder_id = p_folder_id)
  ),
  full_text as (
    select s.id, row_number() over (order by ts_rank_cd(s.search, params.q) desc) as rank_ix
      from scoped s, params
     where p_full_text_weight > 0 and s.search @@ params.q
     order by rank_ix
     limit (select n * 3 from params)
  ),
  semantic as (
    select s.id, row_number() over (order by s.embedding <=> p_query_embedding) as rank_ix
      from scoped s
     where p_query_embedding is not null and p_semantic_weight > 0 and s.embedding is not null
     order by rank_ix
     limit (select n * 3 from params)
  )
  select c.id, c.document_id, c.chunk_index, c.content, d.title, d.url, d.type,
         (coalesce(1.0 / (p_rrf_k + ft.rank_ix), 0.0) * p_full_text_weight
          + coalesce(1.0 / (p_rrf_k + se.rank_ix), 0.0) * p_semantic_weight)::real as score
    from full_text ft
    full outer join semantic se on se.id = ft.id
    join public.knowledge_chunks c on c.id = coalesce(ft.id, se.id)
    join public.knowledge_documents d on d.id = c.document_id
   order by score desc
   limit (select n from params);
$$;

grant execute on function public.match_knowledge(text, extensions.vector, integer, real, real, integer, uuid) to authenticated;
revoke execute on function public.match_knowledge(text, extensions.vector, integer, real, real, integer, uuid) from anon;
