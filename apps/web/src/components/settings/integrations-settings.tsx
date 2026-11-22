"use client";

import { INTELLIGENCE_FEEDS, USER_SOURCE_KINDS, type IntegrationStatus, type IntelligenceFeed, type UserSourceKind } from "@hub/shared";
import { CalendarDays, CircleAlert, Plus, RefreshCw, Rss, Trash2, Unplug } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ListSkeleton } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useSourceMutations, useSources, type SourceWithState } from "@/lib/api/hooks/intelligence";
import { useGoogleCalendar, useIntegrations } from "@/lib/api/hooks/settings";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const FEED_LABEL: Record<IntelligenceFeed, string> = {
  ai_news: "AI News",
  models: "Models",
  products: "Products",
  developer: "Developer",
  github_trending: "GitHub Trending",
  research: "Research",
};

const KIND_LABEL: Record<UserSourceKind, string> = { rss: "RSS / Atom feed", github_releases: "GitHub releases", arxiv: "arXiv search" };

export function IntegrationsPanel() {
  const params = useSearchParams();
  const result = params.get("google");
  useEffect(() => {
    if (result === "connected") toast.success("Google Calendar connected — syncing now");
    else if (result === "error") toast.error("Google Calendar connection failed");
  }, [result]);

  return (
    <div className="space-y-6">
      <IntegrationsCard />
      <SourcesCard />
    </div>
  );
}

function IntegrationsCard() {
  const integrations = useIntegrations();
  const google = useGoogleCalendar();

  const actions = (i: IntegrationStatus) => {
    if (i.provider !== "google_calendar" || !i.configured) return null;
    if (!i.connected)
      return (
        <Button size="sm" disabled={google.connect.isPending} onClick={() => google.connect.mutate()}>
          {google.connect.isPending ? <Spinner /> : <CalendarDays />} Connect
        </Button>
      );
    return (
      <div className="flex gap-1">
        <Button size="sm" variant="outline" disabled={google.sync.isPending} onClick={() => google.sync.mutate()}>
          <RefreshCw /> Sync now
        </Button>
        <Button size="sm" variant="ghost" onClick={() => confirm("Disconnect Google Calendar and remove synced events?") && google.disconnect.mutate()}>
          <Unplug /> Disconnect
        </Button>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrations</CardTitle>
        <CardDescription>Server-level tokens are configured on the API (environment variables) and never sent to the browser.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {integrations.isPending ? (
          <ListSkeleton rows={4} />
        ) : (
          (integrations.data ?? []).map((i) => (
            <div key={i.provider} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <span className={cn("size-2 rounded-full", i.connected ? "bg-success" : i.configured ? "bg-muted-foreground" : "bg-warning")} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {i.name}
                  <Badge variant="outline" className="text-[10px]">
                    {i.scope === "server" ? "server" : "your account"}
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground">{i.description}</p>
                {i.detail && <p className="text-xs text-muted-foreground">{i.detail}</p>}
                {i.integration?.last_synced_at && <p className="text-xs text-muted-foreground">Last synced {relativeTime(i.integration.last_synced_at)}</p>}
                {i.integration?.last_error && (
                  <p className="flex items-center gap-1 text-xs text-destructive">
                    <CircleAlert className="size-3" /> {i.integration.last_error}
                  </p>
                )}
              </div>
              {actions(i)}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function SourcesCard() {
  const sources = useSources();
  const { mute, update, remove, refresh } = useSourceMutations();
  const grouped = new Map<IntelligenceFeed, SourceWithState[]>();
  for (const s of sources.data ?? []) grouped.set(s.feed, [...(grouped.get(s.feed) ?? []), s]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rss className="size-4" /> Intelligence sources
        </CardTitle>
        <CardDescription>
          Built-in sources can be muted for you; your own sources can be paused or removed. Failing sources back off automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <AddSourceForm />
        {sources.isPending ? (
          <ListSkeleton rows={5} />
        ) : (
          [...grouped.entries()].map(([feed, list]) => (
            <div key={feed} className="space-y-1.5">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{FEED_LABEL[feed]}</p>
              {list.map((s) => {
                const active = s.built_in ? !s.muted : s.enabled;
                return (
                  <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm">
                    <Switch
                      checked={active}
                      aria-label={`${active ? "Disable" : "Enable"} ${s.name}`}
                      onCheckedChange={(v) => (s.built_in ? mute.mutate({ id: s.id, muted: !v }) : update.mutate({ id: s.id, enabled: v }))}
                    />
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate", !active && "text-muted-foreground")}>
                        {s.name}
                        {!s.built_in && (
                          <Badge variant="secondary" className="ml-2 text-[10px]">
                            yours
                          </Badge>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {s.last_success_at ? `Updated ${relativeTime(s.last_success_at)}` : "Not fetched yet"}
                        {s.last_error && <span className="text-destructive"> · {s.last_error}</span>}
                      </p>
                    </div>
                    <Button size="icon-xs" variant="ghost" aria-label={`Refresh ${s.name}`} onClick={() => refresh.mutate(s.id)}>
                      <RefreshCw />
                    </Button>
                    {!s.built_in && (
                      <Button size="icon-xs" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => remove.mutate(s.id)}>
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function AddSourceForm() {
  const { create } = useSourceMutations();
  const [kind, setKind] = useState<UserSourceKind>("rss");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [feed, setFeed] = useState<IntelligenceFeed>("ai_news");

  async function submit(e: FormEvent) {
    e.preventDefault();
    await create.mutateAsync({
      kind,
      name: name.trim(),
      feed: kind === "github_releases" ? "developer" : kind === "arxiv" ? "research" : feed,
      ...(kind === "rss" ? { url: value.trim() } : kind === "github_releases" ? { repo: value.trim() } : { query: value.trim() }),
    });
    setName("");
    setValue("");
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-dashed p-3">
      <p className="text-sm font-medium">Add a source</p>
      <div className="grid gap-3 sm:grid-cols-[180px_1fr_1fr]">
        <div className="space-y-1.5">
          <Label>Type</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as UserSourceKind)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {USER_SOURCE_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="src-name">Name</Label>
          <Input id="src-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ollama blog" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="src-value">{kind === "rss" ? "Feed URL" : kind === "github_releases" ? "Repository" : "arXiv query"}</Label>
          <Input
            id="src-value"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={kind === "rss" ? "https://example.com/feed.xml" : kind === "github_releases" ? "owner/repository" : "cat:cs.CL AND abs:retrieval"}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {kind === "rss" && (
          <div className="space-y-1.5">
            <Label>Show in</Label>
            <Select value={feed} onValueChange={(v) => setFeed(v as IntelligenceFeed)}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTELLIGENCE_FEEDS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {FEED_LABEL[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Button type="submit" disabled={create.isPending || !name.trim() || !value.trim()}>
          {create.isPending ? <Spinner /> : <Plus />} Add source
        </Button>
      </div>
    </form>
  );
}
