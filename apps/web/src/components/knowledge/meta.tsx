import type { IndexStatus, KnowledgeDocType } from "@hub/shared";
import { BookOpen, FileCode2, FileText, FlaskConical, Link2, Newspaper, Sparkles, StickyNote, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";

export const DOC_TYPE_META: Record<KnowledgeDocType, { label: string; icon: LucideIcon }> = {
  article: { label: "Article", icon: Newspaper },
  repository: { label: "Repository", icon: FileCode2 },
  paper: { label: "Paper", icon: FlaskConical },
  url: { label: "Link", icon: Link2 },
  note: { label: "Note", icon: StickyNote },
  documentation: { label: "Docs", icon: BookOpen },
  ai_summary: { label: "AI summary", icon: Sparkles },
};

export function DocIcon({ type, className }: { type: KnowledgeDocType; className?: string }) {
  const Icon = DOC_TYPE_META[type]?.icon ?? FileText;
  return <Icon className={className} />;
}

export function IndexBadge({ status }: { status: IndexStatus }) {
  if (status === "indexed") return null;
  if (status === "failed")
    return (
      <Badge variant="outline" className="border-destructive/40 text-[10px] text-destructive">
        Index failed
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
      {status === "processing" ? <Spinner className="size-3" /> : null}
      {status === "processing" ? "Indexing" : "Waiting for local AI"}
    </Badge>
  );
}
