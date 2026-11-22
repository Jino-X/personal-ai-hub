-- ════════════════════════════════════════════════════════════════════════════
-- AI & developer intelligence: categories, sources, items, per-user state,
-- bookmarks, watchlists and ranking functions.
--
-- intelligence_items holds public source content only. Anything personal
-- (read state, bookmarks, relevance, watchlists) lives in user-owned tables.
-- Items from a user's private source carry owner_user_id and are visible only
-- to that user.
-- ════════════════════════════════════════════════════════════════════════════

create table public.intelligence_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  description text,
  keywords text[] not null default '{}',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.news_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete cascade, -- null = built-in source
  kind text not null check (kind in ('rss', 'huggingface_models', 'huggingface_papers', 'github_trending',
                                     'github_releases', 'arxiv', 'product_hunt')),
  name text not null check (char_length(name) between 1 and 120),
  url text,
  feed text not null check (feed in ('ai_news', 'models', 'products', 'developer', 'github_trending', 'research')),
  default_category_id uuid references public.intelligence_categories (id) on delete set null,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  enabled boolean not null default true,
  fetch_interval_minutes integer not null default 60 check (fetch_interval_minutes between 15 and 10080),
  weight real not null default 1.0 check (weight between 0 and 2),
  last_fetched_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index news_sources_identity_idx on public.news_sources (
  coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
  kind,
  coalesce(url, ''),
  coalesce(config ->> 'repo', ''),
  coalesce(config ->> 'query', ''),
  coalesce(config ->> 'language', '')
);
create index news_sources_due_idx on public.news_sources (enabled, last_fetched_at);

create table public.intelligence_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.news_sources (id) on delete set null,
  owner_user_id uuid references public.users (id) on delete cascade,
  feed text not null check (feed in ('ai_news', 'models', 'products', 'developer', 'github_trending', 'research')),
  external_id text,
  url text not null,
  canonical_url text not null,
  url_hash text not null unique,
  title text not null check (char_length(title) between 1 and 1000),
  source_name text not null,
  author text,
  published_at timestamptz, -- exactly as reported by the source; null when unknown, never guessed
  fetched_at timestamptz not null default now(),
  category_id uuid references public.intelligence_categories (id) on delete set null,
  source_excerpt text,      -- verbatim (trimmed) source content
  metadata jsonb not null default '{}'::jsonb, -- source-reported metrics only
  technologies text[] not null default '{}',
  topics text[] not null default '{}',         -- developer tech-topic slugs
  ai_summary text,
  ai_why_it_matters text,
  ai_status text not null default 'pending' check (ai_status in ('pending', 'processing', 'done', 'failed', 'skipped')),
  ai_model text,
  ai_processed_at timestamptz,
  ai_attempts smallint not null default 0,
  ai_error text,
  importance_score smallint not null default 50 check (importance_score between 0 and 100),
  duplicate_of uuid references public.intelligence_items (id) on delete set null,
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(ai_summary, '')), 'B')
    || setweight(to_tsvector('english', public.immutable_array_to_string(technologies)), 'B')
    || setweight(to_tsvector('english', left(coalesce(source_excerpt, ''), 20000)), 'C')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index intelligence_items_feed_published_idx on public.intelligence_items (feed, (coalesce(published_at, fetched_at)) desc)
  where duplicate_of is null;
create index intelligence_items_category_idx on public.intelligence_items (category_id);
create index intelligence_items_source_idx on public.intelligence_items (source_id);
create index intelligence_items_owner_idx on public.intelligence_items (owner_user_id) where owner_user_id is not null;
create index intelligence_items_ai_pending_idx on public.intelligence_items (fetched_at) where ai_status = 'pending';
create index intelligence_items_duplicate_idx on public.intelligence_items (duplicate_of) where duplicate_of is not null;
create index intelligence_items_search_idx on public.intelligence_items using gin (search);
create index intelligence_items_title_trgm_idx on public.intelligence_items using gin (title extensions.gin_trgm_ops);
create index intelligence_items_topics_idx on public.intelligence_items using gin (topics);
create index intelligence_items_created_idx on public.intelligence_items (created_at desc);

create table public.intelligence_item_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  item_id uuid not null references public.intelligence_items (id) on delete cascade,
  read_at timestamptz,
  hidden boolean not null default false,
  feedback smallint check (feedback in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, item_id)
);
create index intelligence_item_states_item_idx on public.intelligence_item_states (item_id);

create table public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  item_id uuid not null references public.intelligence_items (id) on delete cascade,
  note text check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  unique (user_id, item_id)
);
create index bookmarks_item_idx on public.bookmarks (item_id);

create table public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text,
  color text,
  notify boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create unique index watchlists_user_name_idx on public.watchlists (user_id, lower(name));

create table public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null,
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  kind text not null check (kind in ('company', 'model', 'repository', 'framework', 'technology', 'topic', 'keyword')),
  value text not null check (char_length(value) between 2 and 200),
  match_terms text[] not null default '{}',
  config jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz,
  last_seen_release text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (watchlist_id, user_id) references public.watchlists (id, user_id) on delete cascade
);
create unique index watchlist_items_unique_idx on public.watchlist_items (watchlist_id, kind, lower(value));
create index watchlist_items_user_idx on public.watchlist_items (user_id);

create table public.watchlist_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  watchlist_item_id uuid not null references public.watchlist_items (id) on delete cascade,
  item_id uuid not null references public.intelligence_items (id) on delete cascade,
  matched_terms text[] not null default '{}',
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (watchlist_item_id, item_id)
);
create index watchlist_matches_user_idx on public.watchlist_matches (user_id, created_at desc);

-- ── updated_at triggers ─────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array['news_sources', 'intelligence_items', 'intelligence_item_states', 'watchlists', 'watchlist_items']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_set_updated_at', t);
  end loop;
end;
$$;

-- ── Row Level Security ──────────────────────────────────────────────────────

alter table public.intelligence_categories enable row level security;
create policy intelligence_categories_read on public.intelligence_categories for select to authenticated using (true);

alter table public.news_sources enable row level security;
create policy news_sources_select on public.news_sources for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
create policy news_sources_insert_own on public.news_sources for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy news_sources_update_own on public.news_sources for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy news_sources_delete_own on public.news_sources for delete to authenticated
  using (user_id = (select auth.uid()));

alter table public.intelligence_items enable row level security;
create policy intelligence_items_select on public.intelligence_items for select to authenticated
  using (owner_user_id is null or owner_user_id = (select auth.uid()));

alter table public.watchlist_matches enable row level security;
create policy watchlist_matches_select_own on public.watchlist_matches for select to authenticated
  using (user_id = (select auth.uid()));
create policy watchlist_matches_update_own on public.watchlist_matches for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy watchlist_matches_delete_own on public.watchlist_matches for delete to authenticated
  using (user_id = (select auth.uid()));

do $$
declare
  t text;
begin
  foreach t in array array['intelligence_item_states', 'bookmarks', 'watchlists', 'watchlist_items']
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

-- ── Personalised feed ───────────────────────────────────────────────────────
-- Runs as the caller (security invoker) so RLS applies to every table touched.
-- relevance_score (0-100) =
--     55% source/AI importance
--   + 15 if the category is one of the user's interests
--   + up to 20 for interest keyword / watchlist term matches
--   + up to 10 for freshness (decays over ~5 days)

create or replace function public.intelligence_feed(
  p_feed text default null,
  p_category text default null,
  p_technology text default null,
  p_search text default null,
  p_unread_only boolean default false,
  p_bookmarked_only boolean default false,
  p_watchlist_id uuid default null,
  p_since timestamptz default null,
  p_sort text default 'relevance',
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id uuid,
  feed text,
  url text,
  title text,
  source_name text,
  author text,
  published_at timestamptz,
  fetched_at timestamptz,
  category_slug text,
  category_name text,
  source_excerpt text,
  metadata jsonb,
  technologies text[],
  topics text[],
  ai_summary text,
  ai_why_it_matters text,
  ai_status text,
  ai_model text,
  importance_score smallint,
  relevance_score integer,
  is_read boolean,
  is_bookmarked boolean,
  duplicate_count integer,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with me as (
    select auth.uid() as uid
  ),
  prefs as (
    select coalesce(p.interest_categories, '{}'::text[]) as cats,
           coalesce(p.interest_keywords, '{}'::text[]) as kws,
           coalesce(p.muted_source_ids, '{}'::uuid[]) as muted
      from me
      left join public.user_preferences p on p.user_id = me.uid
  ),
  terms as (
    select coalesce(array_agg(distinct lower(t)) filter (where length(t) >= 2), '{}'::text[]) as all_terms
      from (
        select unnest(prefs.kws) as t from prefs
        union all
        select wi.value from public.watchlist_items wi where wi.user_id = (select uid from me)
        union all
        select unnest(wi.match_terms) from public.watchlist_items wi where wi.user_id = (select uid from me)
      ) s
  ),
  watch_terms as (
    select coalesce(array_agg(distinct lower(t)), '{}'::text[]) as wterms
      from (
        select wi.value as t from public.watchlist_items wi where wi.watchlist_id = p_watchlist_id
        union all
        select unnest(wi.match_terms) from public.watchlist_items wi where wi.watchlist_id = p_watchlist_id
      ) s
  ),
  base as (
    select i.*,
           c.slug as c_slug,
           c.name as c_name,
           (st.read_at is not null) as c_is_read,
           (b.id is not null) as c_is_bookmarked,
           i.title || ' ' || coalesce(i.ai_summary, '') || ' ' || array_to_string(i.technologies, ' ') as haystack
      from public.intelligence_items i
      cross join prefs
      left join public.intelligence_categories c on c.id = i.category_id
      left join public.intelligence_item_states st on st.item_id = i.id and st.user_id = (select uid from me)
      left join public.bookmarks b on b.item_id = i.id and b.user_id = (select uid from me)
     where i.duplicate_of is null
       and coalesce(st.hidden, false) = false
       and (i.source_id is null or not (i.source_id = any (prefs.muted)))
       and (p_feed is null or i.feed = p_feed)
       and (p_category is null or c.slug = p_category)
       and (p_technology is null or p_technology = any (i.topics))
       and (p_search is null
            or i.search @@ websearch_to_tsquery('english', p_search)
            or i.title ilike '%' || p_search || '%')
       and (not p_unread_only or st.read_at is null)
       and (not p_bookmarked_only or b.id is not null)
       and (p_since is null or coalesce(i.published_at, i.fetched_at) >= p_since)
  ),
  scored as (
    select base.*,
           least(100, greatest(0, round(
               base.importance_score * 0.55
             + case when base.c_slug = any (prefs.cats) then 15 else 0 end
             + least(20, 7 * (select count(*) from unnest(terms.all_terms) t where public.term_matches(base.haystack, t)))
             + greatest(0, 10 - extract(epoch from (now() - coalesce(base.published_at, base.fetched_at))) / 43200.0)
           )))::integer as score
      from base, prefs, terms
  ),
  filtered as (
    select scored.*
      from scored, watch_terms
     where p_watchlist_id is null
        or exists (select 1 from unnest(watch_terms.wterms) t where public.term_matches(scored.haystack, t))
  )
  select f.id, f.feed, f.url, f.title, f.source_name, f.author, f.published_at, f.fetched_at,
         f.c_slug, f.c_name, f.source_excerpt, f.metadata, f.technologies, f.topics,
         f.ai_summary, f.ai_why_it_matters, f.ai_status, f.ai_model,
         f.importance_score, f.score, f.c_is_read, f.c_is_bookmarked,
         (select count(*)::integer from public.intelligence_items d where d.duplicate_of = f.id),
         count(*) over ()
    from filtered f
   order by
     case when p_sort = 'relevance' then f.score end desc nulls last,
     case when p_sort = 'popular' then coalesce((f.metadata ->> 'popularity')::numeric, 0) end desc nulls last,
     coalesce(f.published_at, f.fetched_at) desc,
     f.id
   limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

grant execute on function public.intelligence_feed(text, text, text, text, boolean, boolean, uuid, timestamptz, text, integer, integer)
  to authenticated;
revoke execute on function public.intelligence_feed(text, text, text, text, boolean, boolean, uuid, timestamptz, text, integer, integer)
  from anon;

-- Near-duplicate detection for news coverage of the same story (service role only).
create or replace function public.find_similar_intelligence_item(
  p_title text,
  p_published_at timestamptz,
  p_feed text,
  p_threshold real default 0.62
)
returns uuid
language sql
stable
set search_path = public, extensions
as $$
  select i.id
    from public.intelligence_items i
   where i.duplicate_of is null
     and i.owner_user_id is null
     and i.feed = p_feed
     and i.title % p_title
     and similarity(i.title, p_title) >= p_threshold
     and coalesce(i.published_at, i.fetched_at)
         between coalesce(p_published_at, now()) - interval '4 days'
             and coalesce(p_published_at, now()) + interval '4 days'
   order by similarity(i.title, p_title) desc
   limit 1;
$$;

revoke execute on function public.find_similar_intelligence_item(text, timestamptz, text, real) from public, anon, authenticated;
