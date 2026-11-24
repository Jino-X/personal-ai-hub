"use client";

import type { FeedItem } from "@hub/shared";
import {
  ArrowUpRight,
  Bookmark,
  BookmarkCheck,
  Ellipsis,
  EyeOff,
  GitFork,
  Heart,
  Download,
  MessageSquare,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  Wand2,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBookmark, useHideItem, useItemState } from "@/lib/api/hooks/intelligence";
import { compactNumber, friendlyDate, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ItemVariant = "news" | "repo" | "model" | "paper" | "release";

function Metric({ icon, value, label }: { icon: ReactNode; value: unknown; label: string }) {
  const formatted = compactNumber(value);
  if (formatted === null) return null;
  return (
    <span className="flex items-center gap-1" title={label}>
      {icon}
      <span className="tabular-nums">{formatted}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function SourceMetrics({ item, variant }: { item: FeedItem; variant: ItemVariant }) {
  const m = item.metadata as Record<string, unknown>;
  const items: ReactNode[] = [];
  if (variant === "repo") {
    if (m.language) items.push(<span key="lang">{String(m.language)}</span>);
    items.push(
      <Metric key="stars" icon={<Star className="size-3" />} value={m.stars} label="stars" />,
      <Metric key="forks" icon={<GitFork className="size-3" />} value={m.forks} label="forks" />,
    );
    if (m.stars_today) items.push(<span key="today" className="flex items-center gap-1 text-success"><TrendingUp className="size-3" />{compactNumber(m.stars_today)} stars today</span>);
  } else if (variant === "model") {
    if (m.pipeline_tag) items.push(<span key="task">{String(m.pipeline_tag)}</span>);
    items.push(
      <Metric key="likes" icon={<Heart className="size-3" />} value={m.likes} label="likes" />,
      <Metric key="dl" icon={<Download className="size-3" />} value={m.downloads} label="downloads" />,
    );
    if (m.license) items.push(<span key="lic">{String(m.license)}</span>);
  } else if (variant === "paper") {
    items.push(<Metric key="up" icon={<ThumbsUp className="size-3" />} value={m.upvotes} label="upvotes" />);
    if (Array.isArray(m.authors) && m.authors.length) items.push(<span key="authors" className="truncate">{(m.authors as string[]).slice(0, 3).join(", ")}{m.authors.length > 3 ? " et al." : ""}</span>);
    if (m.arxiv_url) items.push(<a key="arxiv" className="text-primary hover:underline" href={String(m.arxiv_url)} target="_blank" rel="noopener noreferrer">arXiv</a>);
  } else if (variant === "release") {
    if (m.tag) items.push(<Badge key="tag" variant="outline" className="font-mono text-[10px]">{String(m.tag)}</Badge>);
    if (m.prerelease) items.push(<Badge key="pre" variant="outline" className="text-[10px]">pre-release</Badge>);
  } else if (m.votes !== undefined) {
    items.push(<Metric key="votes" icon={<ThumbsUp className="size-3" />} value={m.votes} label="votes" />);
  }
  const shown = items.filter(Boolean);
  if (shown.length === 0) return null;
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">{shown}</div>;
}

export function ItemCard({
  item,
  variant = "news",
  onExplain,
  extraActions,
}: {
  item: FeedItem;
  variant?: ItemVariant;
  onExplain?: (item: FeedItem) => void;
  extraActions?: (item: FeedItem) => ReactNode;
}) {
  const state = useItemState();
  const bookmark = useBookmark();
  const hide = useHideItem();
  const [expanded, setExpanded] = useState(false);
  const markRead = () => !item.is_read && state.mutate({ id: item.id, read: true });
  const date = item.published_at ? friendlyDate(item.published_at) : `Seen ${relativeTime(item.fetched_at)}`;

  return (
    <Card className={cn("lift gap-3 p-4", item.is_read && "bg-card/55")}>
      {!item.is_read && (
        <span aria-hidden className="absolute inset-y-4 left-0 w-[3px] rounded-r-full bg-primary shadow-[0_0_12px_var(--primary)]" />
      )}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {!item.is_read && <span className="sr-only">Unread</span>}
            <span className="font-medium text-foreground/80">{item.source_name}</span>
            <span>·</span>
            <time dateTime={item.published_at ?? item.fetched_at} title={item.published_at ? "Published (from source)" : "Date not provided by source"}>
              {date}
            </time>
            {item.category_name && (
              <Badge variant="secondary" className="text-[10px]">
                {item.category_name}
              </Badge>
            )}
          </div>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={markRead}
            className={cn("group inline-flex items-start gap-1 text-[15px] leading-snug font-medium hover:text-primary", item.is_read && "text-foreground/75")}
          >
            <span className={variant === "repo" || variant === "model" ? "font-mono text-sm" : undefined}>{item.title}</span>
            <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          </a>
          <SourceMetrics item={item} variant={variant} />
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  "mr-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
                  item.relevance_score >= 75
                    ? "border-primary/40 bg-primary/10 text-primary shadow-[0_0_12px_-4px_var(--primary)]"
                    : item.relevance_score >= 50
                      ? "border-chart-2/40 text-chart-2"
                      : "text-muted-foreground",
                )}
              >
                {item.relevance_score}
              </span>
            </TooltipTrigger>
            <TooltipContent>Relevance to you (0–100): importance, your interests, watchlists and freshness</TooltipContent>
          </Tooltip>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={item.is_bookmarked ? "Remove bookmark" : "Bookmark"}
            aria-pressed={item.is_bookmarked}
            onClick={() => bookmark.mutate({ id: item.id, bookmarked: !item.is_bookmarked })}
          >
            {item.is_bookmarked ? <BookmarkCheck className="text-primary" /> : <Bookmark />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More actions">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onExplain && (
                <DropdownMenuItem onSelect={() => onExplain(item)}>
                  <Wand2 /> Explain in depth
                </DropdownMenuItem>
              )}
              {extraActions?.(item)}
              <DropdownMenuItem onSelect={() => state.mutate({ id: item.id, read: !item.is_read })}>
                <MessageSquare /> Mark as {item.is_read ? "unread" : "read"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => state.mutate({ id: item.id, feedback: 1 })}>
                <ThumbsUp /> More like this
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => state.mutate({ id: item.id, feedback: -1 })}>
                <ThumbsDown /> Less like this
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => hide.mutate(item.id)}>
                <EyeOff /> Hide
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {item.ai_status === "done" && item.ai_summary ? (
        <div className="space-y-1.5 rounded-xl border border-primary/20 bg-[linear-gradient(135deg,color-mix(in_oklch,var(--primary)_9%,transparent),color-mix(in_oklch,var(--chart-2)_5%,transparent))] p-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.05)]">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
            <Sparkles className="size-3" /> AI summary
            <span className="font-normal text-muted-foreground">· generated by {item.ai_model ?? "local AI"} from the source text</span>
          </p>
          <p className="text-sm">{item.ai_summary}</p>
          {item.ai_why_it_matters && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground/80">Why it matters: </span>
              {item.ai_why_it_matters}
            </p>
          )}
        </div>
      ) : item.ai_status === "pending" || item.ai_status === "processing" ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="size-3" /> AI summary pending — generated when your local AI is available.
        </p>
      ) : null}

      {item.source_excerpt && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">From the source</p>
          <p className={cn("text-sm whitespace-pre-line text-muted-foreground", !expanded && "line-clamp-3")}>{item.source_excerpt}</p>
          {item.source_excerpt.length > 240 && (
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}

      {(item.technologies.length > 0 || item.duplicate_count > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {item.technologies.map((t) => (
            <Badge key={t} variant="outline" className="text-[10px] font-normal">
              {t}
            </Badge>
          ))}
          {item.duplicate_count > 0 && (
            <span className="text-[11px] text-muted-foreground">
              Also covered by {item.duplicate_count} other source{item.duplicate_count > 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
