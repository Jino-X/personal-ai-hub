"use client";

import { ArrowUpRight, RefreshCw, Sparkles, Tag, Trash2 } from "lucide-react";
import { useState } from "react";
import { Markdown } from "@/components/common/markdown";
import { ErrorState } from "@/components/common/states";
import { parseTags } from "@/components/productivity/meta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocument, useFolders, useKnowledgeMutations } from "@/lib/api/hooks/knowledge";
import { friendlyDate, relativeTime } from "@/lib/format";
import { DOC_TYPE_META, DocIcon, IndexBadge } from "./meta";

const NONE = "__none__";

export function DocumentSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const doc = useDocument(id);
  const folders = useFolders();
  const { update, remove, reindex } = useKnowledgeMutations();
  const [tagInput, setTagInput] = useState<string | null>(null);
  const d = doc.data;
  const suggested = ((d?.metadata?.suggested_tags as string[] | undefined) ?? []).filter((t) => !d?.tags.includes(t));

  return (
    <Sheet open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-2xl">
        {doc.isPending ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : doc.isError || !d ? (
          <div className="p-6">
            <ErrorState error={doc.error} onRetry={() => void doc.refetch()} compact />
          </div>
        ) : (
          <>
            <SheetHeader className="border-b">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <DocIcon type={d.type} className="size-3.5" />
                {DOC_TYPE_META[d.type].label} · saved {relativeTime(d.created_at)}
                <IndexBadge status={d.index_status} />
              </div>
              <SheetTitle className="pr-8 text-lg leading-snug">{d.title}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                {d.url && (
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    {new URL(d.url).hostname} <ArrowUpRight className="size-3" />
                  </a>
                )}
                {typeof d.metadata?.published_at === "string" && <span>Published {friendlyDate(d.metadata.published_at as string)}</span>}
                {d.chunk_count > 0 && <span>{d.chunk_count} chunks indexed</span>}
              </SheetDescription>
            </SheetHeader>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-5 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={d.folder_id ?? NONE}
                    onValueChange={(v) => update.mutate({ id: d.id, folder_id: v === NONE ? null : v }, { onSuccess: () => void doc.refetch() })}
                  >
                    <SelectTrigger size="sm" className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No folder</SelectItem>
                      {(folders.data?.items ?? []).map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" onClick={() => reindex.mutate(d.id)}>
                    <RefreshCw /> Re-index
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => {
                      if (confirm("Delete this document and its embeddings?")) remove.mutate(d.id, { onSuccess: onClose });
                    }}
                  >
                    <Trash2 /> Delete
                  </Button>
                </div>

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Tag className="size-3.5 text-muted-foreground" />
                    {d.tags.map((t) => (
                      <Badge key={t} variant="secondary">
                        #{t}
                      </Badge>
                    ))}
                    {tagInput === null ? (
                      <Button size="xs" variant="ghost" onClick={() => setTagInput(d.tags.join(", "))}>
                        Edit tags
                      </Button>
                    ) : (
                      <form
                        className="flex gap-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          update.mutate({ id: d.id, tags: parseTags(tagInput) }, { onSuccess: () => void doc.refetch() });
                          setTagInput(null);
                        }}
                      >
                        <Input className="h-7 w-56" autoFocus value={tagInput} onChange={(e) => setTagInput(e.target.value)} />
                        <Button size="xs" type="submit">
                          Save
                        </Button>
                      </form>
                    )}
                  </div>
                  {suggested.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Sparkles className="size-3 text-primary" /> Suggested:
                      {suggested.map((t) => (
                        <button
                          key={t}
                          type="button"
                          className="rounded-full border border-dashed px-2 py-0.5 hover:border-solid hover:bg-accent"
                          onClick={() => update.mutate({ id: d.id, tags: [...d.tags, t] }, { onSuccess: () => void doc.refetch() })}
                        >
                          + {t}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {d.ai_summary && (
                  <div className="space-y-1 rounded-lg border border-primary/15 bg-primary/[0.04] p-3">
                    <p className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
                      <Sparkles className="size-3" /> AI summary
                      {d.auto_category && <span className="font-normal text-muted-foreground">· category: {d.auto_category}</span>}
                    </p>
                    <p className="text-sm">{d.ai_summary}</p>
                  </div>
                )}
                {d.index_error && d.index_status === "failed" && <p className="text-xs text-destructive">Indexing error: {d.index_error}</p>}

                <div className="space-y-1">
                  <p className="text-[11px] font-medium text-muted-foreground">{d.type === "note" || d.type === "documentation" ? "Content" : "Saved content"}</p>
                  {d.type === "note" || d.type === "documentation" || d.type === "repository" ? (
                    <Markdown>{d.content ?? ""}</Markdown>
                  ) : (
                    <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">{d.content}</p>
                  )}
                </div>
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
