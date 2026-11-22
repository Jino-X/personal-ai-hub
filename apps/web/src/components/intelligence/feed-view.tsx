"use client";

import { TECH_TOPICS, type CategorySlug, type FeedItem, type IntelligenceFeed } from "@hub/shared";
import { Bookmark, CheckCheck, Inbox, RefreshCw, Search, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useDeferredValue, useState } from "react";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { CardGridSkeleton, EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { useCategories, useFeed, useIntelStatus, useMarkAllRead, useRefreshFeeds, type FeedFilters } from "@/lib/api/hooks/intelligence";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ExplainDialog } from "./explain-dialog";
import { ItemCard, type ItemVariant } from "./item-card";
import { ItemActions } from "./item-actions";

export interface FeedTab {
  feed: IntelligenceFeed;
  label: string;
  variant: ItemVariant;
}

interface FeedViewProps {
  title: string;
  description: string;
  tabs: FeedTab[];
  showCategories?: boolean;
  showTechnologies?: boolean;
  defaultSort?: "relevance" | "newest" | "popular";
}

export function FeedView({ title, description, tabs, showCategories = false, showTechnologies = false, defaultSort = "relevance" }: FeedViewProps) {
  const params = useSearchParams();
  const [tab, setTab] = useState(tabs[0]!.feed);
  const [search, setSearch] = useState(params.get("q") ?? "");
  const q = useDeferredValue(search.trim());
  const [category, setCategory] = useState<CategorySlug | "all">("all");
  const [technology, setTechnology] = useState<string | null>(null);
  const [sort, setSort] = useState(defaultSort);
  const [unread, setUnread] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [explaining, setExplaining] = useState<FeedItem | null>(null);

  const active = tabs.find((t) => t.feed === tab) ?? tabs[0]!;
  const filters: FeedFilters = {
    feed: active.feed,
    sort,
    ...(q ? { q } : {}),
    ...(category !== "all" ? { category } : {}),
    ...(technology ? { technology } : {}),
    ...(unread ? { unread: true } : {}),
    ...(bookmarked ? { bookmarked: true } : {}),
  };
  const feed = useFeed(filters);
  const { data: categories = [] } = useCategories();
  const status = useIntelStatus();
  const markAll = useMarkAllRead();
  const refresh = useRefreshFeeds();

  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const total = feed.data?.pages[0]?.total ?? 0;
  const lastUpdated = status.data?.last_updated[active.feed];

  return (
    <PageContainer>
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            <Button variant="outline" size="sm" disabled={markAll.isPending} onClick={() => markAll.mutate(active.feed)}>
              <CheckCheck /> Mark all read
            </Button>
            <Button variant="outline" size="sm" disabled={refresh.isPending} onClick={() => refresh.mutate(active.feed)}>
              {refresh.isPending ? <Spinner /> : <RefreshCw />} Refresh
            </Button>
          </>
        }
      />

      {tabs.length > 1 && (
        <Tabs value={tab} onValueChange={(v) => setTab(v as IntelligenceFeed)}>
          <TabsList>
            {tabs.map((t) => (
              <TabsTrigger key={t.feed} value={t.feed}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search titles, summaries and technologies" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          {showCategories && (
            <Select value={category} onValueChange={(v) => setCategory(v as CategorySlug | "all")}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.slug} value={c.slug}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="relevance">Most relevant</SelectItem>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="popular">Most popular</SelectItem>
            </SelectContent>
          </Select>
          <Toggle variant="outline" pressed={unread} onPressedChange={setUnread} aria-label="Unread only">
            <Inbox /> Unread
          </Toggle>
          <Toggle variant="outline" pressed={bookmarked} onPressedChange={setBookmarked} aria-label="Bookmarked only">
            <Bookmark /> Saved
          </Toggle>
        </div>
      </div>

      {showTechnologies && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by technology">
          {TECH_TOPICS.map((t) => (
            <button
              key={t.slug}
              type="button"
              aria-pressed={technology === t.slug}
              onClick={() => setTechnology((cur) => (cur === t.slug ? null : t.slug))}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent",
                technology === t.slug && "border-primary bg-primary/10 text-primary",
              )}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{feed.isPending ? "Loading…" : `${total} item${total === 1 ? "" : "s"}`}</span>
        {lastUpdated && <span>Updated {relativeTime(lastUpdated)}</span>}
        {(status.data?.pending_ai ?? 0) > 0 && (
          <span className="flex items-center gap-1">
            <Sparkles className="size-3" /> {status.data!.pending_ai} awaiting AI summary
          </span>
        )}
      </p>

      {feed.isPending ? (
        <CardGridSkeleton cards={4} />
      ) : feed.isError ? (
        <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={q || unread || bookmarked || category !== "all" || technology ? "Nothing matches these filters" : "No items yet"}
          description={
            q || unread || bookmarked || category !== "all" || technology
              ? "Try clearing a filter."
              : "Sources are fetched in the background every few hours. Use Refresh to fetch now."
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} variant={active.variant} onExplain={setExplaining} extraActions={(i) => <ItemActions item={i} />} />
          ))}
          {feed.hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
                {feed.isFetchingNextPage && <Spinner />} Load more
              </Button>
            </div>
          )}
        </div>
      )}

      <ExplainDialog item={explaining} onClose={() => setExplaining(null)} />
    </PageContainer>
  );
}
