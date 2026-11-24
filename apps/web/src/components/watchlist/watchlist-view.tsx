"use client";

import { WATCH_KINDS, type FeedItem, type WatchKind, type WatchlistWithItems } from "@hub/shared";
import { Bell, BellOff, CheckCheck, Eye, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { CardGridSkeleton, EmptyState, ErrorState } from "@/components/common/states";
import { ExplainDialog } from "@/components/intelligence/explain-dialog";
import { ItemActions } from "@/components/intelligence/item-actions";
import { ItemCard } from "@/components/intelligence/item-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFeed } from "@/lib/api/hooks/intelligence";
import { useWatchlistMutations, useWatchlists, useWatchMatches } from "@/lib/api/hooks/watchlist";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<WatchKind, string> = {
  company: "Company",
  model: "Model",
  repository: "Repository",
  framework: "Framework",
  technology: "Technology",
  topic: "Research topic",
  keyword: "Keyword",
};

const SUGGESTIONS: { kind: WatchKind; value: string }[] = [
  { kind: "company", value: "OpenAI" },
  { kind: "company", value: "Anthropic" },
  { kind: "company", value: "Google DeepMind" },
  { kind: "model", value: "Qwen3" },
  { kind: "model", value: "Llama" },
  { kind: "model", value: "DeepSeek" },
  { kind: "repository", value: "ollama/ollama" },
  { kind: "repository", value: "modelcontextprotocol/servers" },
  { kind: "framework", value: "LangGraph" },
  { kind: "topic", value: "MCP" },
  { kind: "topic", value: "AI agents" },
  { kind: "keyword", value: "RAG" },
];

export function WatchlistView() {
  const params = useSearchParams();
  const lists = useWatchlists();
  const { create } = useWatchlistMutations();
  const [selectedId, setSelectedId] = useState<string | null>(params.get("watchlist"));
  const [newName, setNewName] = useState("");

  const all = lists.data ?? [];
  const selected = all.find((l) => l.id === selectedId) ?? all[0] ?? null;

  async function createList(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const created = await create.mutateAsync({ name: newName.trim(), notify: true });
    setSelectedId(created.id);
    setNewName("");
  }

  return (
    <PageContainer wide>
      <PageHeader title="Watchlist" description="Follow companies, models, repositories, frameworks, technologies and topics. You'll be alerted when something relevant appears." />

      {lists.isPending ? (
        <CardGridSkeleton cards={3} />
      ) : lists.isError ? (
        <ErrorState error={lists.error} onRetry={() => void lists.refetch()} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <nav className="space-y-1" aria-label="Watchlists">
            {all.map((l) => {
              const unseen = l.items.reduce((n, i) => n + i.match_count, 0);
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setSelectedId(l.id)}
                  data-active={selected?.id === l.id}
                  className="nav-item flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <Eye className="size-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{l.name}</span>
                  {unseen > 0 && <Badge className="h-5 px-1.5 text-[10px]">{unseen}</Badge>}
                </button>
              );
            })}
            <form onSubmit={createList} className="flex gap-1 pt-2">
              <Input className="h-8" placeholder="New watchlist" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <Button size="icon-sm" type="submit" aria-label="Create watchlist" disabled={!newName.trim() || create.isPending}>
                <Plus />
              </Button>
            </form>
          </nav>

          {selected ? (
            <WatchlistDetail key={selected.id} list={selected} />
          ) : (
            <EmptyState
              icon={Eye}
              title="Create your first watchlist"
              description="For example “AI labs”, “Frameworks I use” or “Interview prep topics”."
            />
          )}
        </div>
      )}
    </PageContainer>
  );
}

function WatchlistDetail({ list }: { list: WatchlistWithItems }) {
  const { update, remove, addItem, removeItem, markSeen } = useWatchlistMutations();
  const [kind, setKind] = useState<WatchKind>("company");
  const [value, setValue] = useState("");
  const [synonyms, setSynonyms] = useState("");
  const [explaining, setExplaining] = useState<FeedItem | null>(null);
  const feed = useFeed({ watchlist_id: list.id, sort: "newest" });
  const matches = useWatchMatches(list.id);
  const feedItems = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const existing = new Set(list.items.map((i) => `${i.kind}:${i.value.toLowerCase()}`));

  async function add(e: FormEvent) {
    e.preventDefault();
    if (value.trim().length < 2) return;
    await addItem.mutateAsync({
      watchlistId: list.id,
      kind,
      value: value.trim(),
      match_terms: synonyms
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length >= 2),
    });
    setValue("");
    setSynonyms("");
  }

  return (
    <div className="min-w-0 space-y-5">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>{list.name}</CardTitle>
            <CardDescription>{list.items.length} followed · {list.notify ? "alerts on" : "alerts off"}</CardDescription>
          </div>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => update.mutate({ id: list.id, notify: !list.notify })}>
              {list.notify ? <BellOff /> : <Bell />} {list.notify ? "Mute alerts" : "Enable alerts"}
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Delete watchlist" onClick={() => confirm(`Delete "${list.name}"?`) && remove.mutate(list.id)}>
              <Trash2 />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {list.items.map((i) => (
              <span key={i.id} className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 py-1 pr-1 pl-3 text-sm">
                <span className="text-[10px] tracking-wide text-muted-foreground uppercase">{KIND_LABEL[i.kind]}</span>
                <span className={i.kind === "repository" ? "font-mono text-xs" : undefined}>{i.value}</span>
                {i.match_terms.length > 0 && <span className="text-xs text-muted-foreground">+{i.match_terms.length}</span>}
                {i.match_count > 0 && <Badge className="h-4 px-1 text-[10px]">{i.match_count}</Badge>}
                <button type="button" aria-label={`Stop following ${i.value}`} className="rounded-full p-0.5 hover:bg-accent" onClick={() => removeItem.mutate(i.id)}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
            {list.items.length === 0 && <p className="text-sm text-muted-foreground">Nothing followed yet — add something below or pick a suggestion.</p>}
          </div>

          <form onSubmit={add} className="flex flex-col gap-2 md:flex-row">
            <Select value={kind} onValueChange={(v) => setKind(v as WatchKind)}>
              <SelectTrigger className="md:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WATCH_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder={kind === "repository" ? "owner/repository" : kind === "company" ? "e.g. Mistral AI" : "Name or keyword"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <Input className="md:w-56" placeholder="Synonyms (comma separated)" value={synonyms} onChange={(e) => setSynonyms(e.target.value)} />
            <Button type="submit" disabled={addItem.isPending || value.trim().length < 2}>
              {addItem.isPending ? <Spinner /> : <Plus />} Follow
            </Button>
          </form>

          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.filter((s) => !existing.has(`${s.kind}:${s.value.toLowerCase()}`)).map((s) => (
              <button
                key={`${s.kind}:${s.value}`}
                type="button"
                className="rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground hover:border-solid hover:bg-accent hover:text-foreground"
                onClick={() => addItem.mutate({ watchlistId: list.id, kind: s.kind, value: s.value })}
              >
                + {s.value}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="alerts">
        <div className="flex items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="alerts">Alerts</TabsTrigger>
            <TabsTrigger value="feed">Matching feed</TabsTrigger>
          </TabsList>
          <Button variant="ghost" size="sm" onClick={() => markSeen.mutate({ watchlist_id: list.id })}>
            <CheckCheck /> Mark all seen
          </Button>
        </div>

        <TabsContent value="alerts" className="mt-3 space-y-2">
          {matches.isPending ? (
            <CardGridSkeleton cards={2} />
          ) : (matches.data ?? []).length === 0 ? (
            <EmptyState icon={Bell} title="No alerts yet" description="New items that mention what you follow will show up here as sources are fetched." />
          ) : (
            (matches.data ?? []).map((m) => (
              <a
                key={m.id}
                href={m.item?.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => !m.seen_at && markSeen.mutate({ ids: [m.id] })}
                className={cn("block rounded-lg border p-3 transition-colors hover:bg-accent/40", !m.seen_at && "border-primary/30 bg-primary/[0.03]")}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {!m.seen_at && <span className="size-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />}
                  <Badge variant="secondary" className="text-[10px]">
                    {m.watchlist_item?.value}
                  </Badge>
                  <span>{m.item?.source_name}</span>
                  <span>· matched {relativeTime(m.created_at)}</span>
                  <span>· terms: {m.matched_terms.join(", ")}</span>
                </div>
                <p className="mt-1 text-sm font-medium">{m.item?.title}</p>
                {m.item?.ai_summary && (
                  <p className="mt-1 flex gap-1.5 text-xs text-muted-foreground">
                    <Sparkles className="mt-0.5 size-3 shrink-0 text-primary" /> {m.item.ai_summary}
                  </p>
                )}
              </a>
            ))
          )}
        </TabsContent>

        <TabsContent value="feed" className="mt-3 space-y-3">
          {feed.isPending ? (
            <CardGridSkeleton cards={2} />
          ) : feedItems.length === 0 ? (
            <EmptyState icon={Eye} title="No matching items" description="Items mentioning what this watchlist follows will appear here." />
          ) : (
            <>
              {feedItems.map((item) => (
                <ItemCard key={item.id} item={item} onExplain={setExplaining} extraActions={(i) => <ItemActions item={i} />} />
              ))}
              {feed.hasNextPage && (
                <div className="flex justify-center">
                  <Button variant="outline" onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
                    {feed.isFetchingNextPage && <Spinner />} Load more
                  </Button>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
      <ExplainDialog item={explaining} onClose={() => setExplaining(null)} />
    </div>
  );
}
