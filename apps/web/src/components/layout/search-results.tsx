"use client";

import { useQuery } from "@tanstack/react-query";
import { BookMarked, Bot, ListTodo, Target } from "lucide-react";
import { useDeferredValue } from "react";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api/client";

interface SearchResponse {
  tasks: { id: string; title: string; status: string }[];
  goals: { id: string; title: string }[];
  knowledge: { id: string; title: string; type: string }[];
  intelligence: { id: string; title: string; source_name: string; feed: string }[];
}

const FEED_PATH: Record<string, string> = {
  ai_news: "/intelligence/ai-news",
  models: "/intelligence/ai-news",
  products: "/intelligence/ai-news",
  developer: "/intelligence/developer-news",
  github_trending: "/intelligence/github-trending",
  research: "/intelligence/research",
};

/** Global search across tasks, goals, knowledge and intelligence (server-side, RLS-scoped). */
export function SearchResults({ query, onSelect }: { query: string; onSelect: (href: string) => void }) {
  const q = useDeferredValue(query);
  const { data, isFetching } = useQuery({
    queryKey: ["search", q],
    queryFn: ({ signal }) => api<SearchResponse>("/v1/search", { query: { q }, signal }),
    staleTime: 15_000,
  });

  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
        <Spinner /> Searching…
      </div>
    );
  }

  return (
    <>
      {isFetching && <div className="px-3 py-1 text-xs text-muted-foreground">Updating…</div>}
      {data.tasks.length > 0 && (
        <CommandGroup heading="Tasks">
          {data.tasks.map((t) => (
            <CommandItem key={t.id} value={`task-${t.id}`} onSelect={() => onSelect(`/productivity/tasks?task=${t.id}`)}>
              <ListTodo /> <span className="truncate">{t.title}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
      {data.goals.length > 0 && (
        <CommandGroup heading="Goals">
          {data.goals.map((g) => (
            <CommandItem key={g.id} value={`goal-${g.id}`} onSelect={() => onSelect(`/productivity/goals?goal=${g.id}`)}>
              <Target /> <span className="truncate">{g.title}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
      {data.knowledge.length > 0 && (
        <CommandGroup heading="Knowledge">
          {data.knowledge.map((d) => (
            <CommandItem key={d.id} value={`doc-${d.id}`} onSelect={() => onSelect(`/knowledge?doc=${d.id}`)}>
              <BookMarked /> <span className="truncate">{d.title}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
      {data.intelligence.length > 0 && (
        <CommandGroup heading="Intelligence">
          {data.intelligence.map((i) => (
            <CommandItem
              key={i.id}
              value={`item-${i.id}`}
              onSelect={() => onSelect(`${FEED_PATH[i.feed] ?? "/intelligence/ai-news"}?q=${encodeURIComponent(i.title.slice(0, 80))}`)}
            >
              <Bot /> <span className="truncate">{i.title}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{i.source_name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
    </>
  );
}
