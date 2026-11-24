"use client";

import { KNOWLEDGE_DOC_TYPES, type KnowledgeDocType } from "@hub/shared";
import { BookMarked, Folder, FolderPlus, Inbox, Link2, MessageSquareText, Plus, Search, Sparkles, StickyNote, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useDeferredValue, useState, type FormEvent, type ReactNode } from "react";
import { Markdown } from "@/components/common/markdown";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAskKnowledge, useDocuments, useFolders, useKnowledgeMutations, useKnowledgeSearch, useKnowledgeTags } from "@/lib/api/hooks/knowledge";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NoteDialog, SaveUrlDialog } from "./add-dialogs";
import { DocumentSheet } from "./document-sheet";
import { DOC_TYPE_META, DocIcon, IndexBadge } from "./meta";

type FolderFilter = "all" | string;

export function KnowledgeView() {
  const params = useSearchParams();
  const [folder, setFolder] = useState<FolderFilter>("all");
  const [type, setType] = useState<KnowledgeDocType | "all">("all");
  const [tag, setTag] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const q = useDeferredValue(filter.trim());
  const [openDoc, setOpenDoc] = useState<string | null>(params.get("doc"));
  const [dialog, setDialog] = useState<"url" | "note" | null>(null);

  const folderId = folder === "all" ? undefined : folder;
  const docs = useDocuments({ folder_id: folderId, type: type === "all" ? undefined : type, tag: tag ?? undefined, q: q || undefined });
  const items = docs.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <PageContainer wide>
      <PageHeader
        title="Knowledge Vault"
        description="Save articles, repositories, papers, links and notes. Everything is embedded locally so you can search by meaning and ask questions."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Plus /> Add
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setDialog("url")}>
                <Link2 /> Save a link
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog("note")}>
                <StickyNote /> Write a note
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <FolderNav selected={folder} onSelect={setFolder} tag={tag} onTag={setTag} />

        <Tabs defaultValue="library" className="min-w-0">
          <TabsList>
            <TabsTrigger value="library">
              <BookMarked /> Library
            </TabsTrigger>
            <TabsTrigger value="search">
              <Search /> Semantic search
            </TabsTrigger>
            <TabsTrigger value="ask">
              <MessageSquareText /> Ask your vault
            </TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="mt-4 space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8" placeholder="Filter by title or text" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
              <Select value={type} onValueChange={(v) => setType(v as KnowledgeDocType | "all")}>
                <SelectTrigger className="sm:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {KNOWLEDGE_DOC_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {DOC_TYPE_META[t].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {tag && (
              <Badge variant="secondary" className="gap-1">
                #{tag}
                <button type="button" aria-label="Clear tag filter" onClick={() => setTag(null)}>
                  ×
                </button>
              </Badge>
            )}

            {docs.isPending ? (
              <ListSkeleton rows={6} />
            ) : docs.isError ? (
              <ErrorState error={docs.error} onRetry={() => void docs.refetch()} />
            ) : items.length === 0 ? (
              <EmptyState
                icon={BookMarked}
                title={q || tag || type !== "all" ? "No documents match" : "Your vault is empty"}
                description="Save a link or write a note. You can also save items from the AI News and Developer feeds."
                action={
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => setDialog("url")}>
                      <Link2 /> Save a link
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setDialog("note")}>
                      <StickyNote /> Write a note
                    </Button>
                  </div>
                }
              />
            ) : (
              <div className="space-y-2">
                {items.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setOpenDoc(d.id)}
                    data-slot="card"
                    className="lift flex w-full items-start gap-3 rounded-xl border bg-card/80 p-3 text-left"
                  >
                    <div className="icon-chip size-8 shrink-0 rounded-lg">
                      <DocIcon type={d.type} className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-sm font-medium">{d.title}</p>
                      {(d.ai_summary || d.excerpt) && <p className="line-clamp-2 text-xs text-muted-foreground">{d.ai_summary ?? d.excerpt}</p>}
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{DOC_TYPE_META[d.type].label}</span>
                        {d.url && <span className="truncate">{new URL(d.url).hostname}</span>}
                        <span>{relativeTime(d.created_at)}</span>
                        {d.tags.slice(0, 4).map((t) => (
                          <span key={t}>#{t}</span>
                        ))}
                        <IndexBadge status={d.index_status} />
                      </div>
                    </div>
                  </button>
                ))}
                {docs.hasNextPage && (
                  <div className="flex justify-center">
                    <Button variant="outline" onClick={() => void docs.fetchNextPage()} disabled={docs.isFetchingNextPage}>
                      {docs.isFetchingNextPage && <Spinner />} Load more
                    </Button>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="search" className="mt-4">
            <SemanticSearch folderId={folderId ?? null} onOpen={setOpenDoc} />
          </TabsContent>

          <TabsContent value="ask" className="mt-4">
            <AskPanel folderId={folderId ?? null} onOpen={setOpenDoc} />
          </TabsContent>
        </Tabs>
      </div>

      <DocumentSheet id={openDoc} onClose={() => setOpenDoc(null)} />
      <SaveUrlDialog open={dialog === "url"} onOpenChange={(o) => setDialog(o ? "url" : null)} defaultFolder={folderId} />
      <NoteDialog open={dialog === "note"} onOpenChange={(o) => setDialog(o ? "note" : null)} defaultFolder={folderId} />
    </PageContainer>
  );
}

function FolderNav({ selected, onSelect, tag, onTag }: { selected: FolderFilter; onSelect: (f: FolderFilter) => void; tag: string | null; onTag: (t: string | null) => void }) {
  const folders = useFolders();
  const tags = useKnowledgeTags();
  const { createFolder, removeFolder } = useKnowledgeMutations();
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await createFolder.mutateAsync({ name: name.trim() });
    setName("");
    setAdding(false);
  }

  const row = (id: FolderFilter, label: string, count: number | undefined, icon: ReactNode, onDelete?: () => void) => (
    <div key={id} className="group relative">
      <button
        type="button"
        onClick={() => onSelect(id)}
        data-active={selected === id}
        className="nav-item flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
      >
        {icon}
        <span className="flex-1 truncate">{label}</span>
        {count !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{count}</span>}
      </button>
      {onDelete && (
        <Button size="icon-xs" variant="ghost" aria-label={`Delete folder ${label}`} className="absolute top-1 right-1 hidden group-hover:inline-flex" onClick={onDelete}>
          <Trash2 />
        </Button>
      )}
    </div>
  );

  return (
    <nav className="space-y-4" aria-label="Folders and tags">
      <div className="space-y-1">
        {row("all", "All documents", folders.data?.total, <Inbox className="size-4" />)}
        <div className="flex items-center justify-between pt-2 pb-1">
          <span className="px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Folders</span>
          <Button size="icon-xs" variant="ghost" aria-label="New folder" onClick={() => setAdding((v) => !v)}>
            <FolderPlus />
          </Button>
        </div>
        {adding && (
          <form onSubmit={add} className="px-1">
            <Input className="h-8" autoFocus placeholder="Folder name" value={name} onChange={(e) => setName(e.target.value)} />
          </form>
        )}
        {(folders.data?.items ?? []).map((f) =>
          row(f.id, f.name, f.document_count, <Folder className="size-4" />, () => {
            if (confirm(`Delete folder "${f.name}"? Documents inside are kept.`)) {
              removeFolder.mutate(f.id);
              if (selected === f.id) onSelect("all");
            }
          }),
        )}
      </div>
      {(tags.data ?? []).length > 0 && (
        <div className="space-y-2">
          <span className="px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Tags</span>
          <div className="flex flex-wrap gap-1 px-1">
            {(tags.data ?? []).map((t) => (
              <button
                key={t.tag}
                type="button"
                onClick={() => onTag(tag === t.tag ? null : t.tag)}
                className={cn("rounded-full border px-2 py-0.5 text-xs hover:bg-accent", tag === t.tag && "border-primary bg-primary/10 text-primary")}
              >
                #{t.tag} <span className="text-muted-foreground">{t.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}

function SemanticSearch({ folderId, onOpen }: { folderId: string | null; onOpen: (id: string) => void }) {
  const search = useKnowledgeSearch();
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"hybrid" | "semantic" | "fulltext">("hybrid");

  const run = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) search.mutate({ q: q.trim(), mode, folder_id: folderId });
  };

  return (
    <div className="space-y-4">
      <form onSubmit={run} className="flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Search by meaning, e.g. “how do HNSW indexes trade recall for speed?”" value={q} onChange={(e) => setQ(e.target.value)} />
        <ToggleGroup type="single" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as typeof mode)}>
          <ToggleGroupItem value="hybrid">Hybrid</ToggleGroupItem>
          <ToggleGroupItem value="semantic">Semantic</ToggleGroupItem>
          <ToggleGroupItem value="fulltext">Keyword</ToggleGroupItem>
        </ToggleGroup>
        <Button type="submit" disabled={search.isPending || !q.trim()}>
          {search.isPending ? <Spinner /> : <Search />} Search
        </Button>
      </form>
      {search.data?.note && <p className="text-xs text-warning">{search.data.note}</p>}
      {search.isError && <ErrorState error={search.error} compact />}
      {search.data && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {search.data.items.length} results · {search.data.mode_used} search
          </p>
          {search.data.items.map((m) => (
            <button key={m.chunk_id} type="button" onClick={() => onOpen(m.document_id)} data-slot="card" className="lift block w-full rounded-xl border bg-card/80 p-3 text-left">
              <div className="flex items-center gap-2 text-sm font-medium">
                <DocIcon type={m.doc_type} className="size-4 text-muted-foreground" />
                {m.title}
              </div>
              <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{m.content}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AskPanel({ folderId, onOpen }: { folderId: string | null; onOpen: (id: string) => void }) {
  const ask = useAskKnowledge();
  const [question, setQuestion] = useState("");

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) ask.mutate({ question: question.trim(), folder_id: folderId });
        }}
        className="space-y-2"
      >
        <Textarea rows={3} placeholder="Ask a question about your saved knowledge…" value={question} onChange={(e) => setQuestion(e.target.value)} />
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Answers come only from your documents, with citations.{folderId ? " Limited to this folder." : ""}</p>
          <Button type="submit" disabled={ask.isPending || !question.trim()}>
            {ask.isPending ? <Spinner /> : <Sparkles />} Ask
          </Button>
        </div>
      </form>
      {ask.isError && <ErrorState error={ask.error} compact />}
      {ask.data && (
        <Card>
          <CardContent className="space-y-4">
            <Markdown>{ask.data.answer}</Markdown>
            {ask.data.citations.length > 0 && (
              <div className="space-y-1.5 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">Sources</p>
                {ask.data.citations.map((c) => (
                  <button key={c.ref} type="button" onClick={() => onOpen(c.id)} className="flex w-full items-start gap-2 text-left text-sm hover:text-primary">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded bg-muted text-[11px] font-semibold">{c.ref}</span>
                    <span>
                      <span className="font-medium">{c.title}</span>
                      <span className="line-clamp-1 text-xs text-muted-foreground">{c.snippet}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">AI-generated by {ask.data.model ?? "local AI"} from your documents.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
