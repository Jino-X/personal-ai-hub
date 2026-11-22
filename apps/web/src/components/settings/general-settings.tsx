"use client";

import { INTELLIGENCE_CATEGORIES, type CategorySlug, type NotificationPreferences } from "@hub/shared";
import { Download, History, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useState, type FormEvent } from "react";
import { ListSkeleton } from "@/components/common/states";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMe, useUpdateNotificationPrefs, useUpdatePreferences, useUpdateProfile, type MeResponse } from "@/lib/api/hooks/me";
import { useAuditLogs, useDeleteAccount, useExportData } from "@/lib/api/hooks/settings";
import { useJobs } from "@/lib/api/hooks/system";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function GeneralSettings() {
  const me = useMe();
  if (!me.data) return <ListSkeleton rows={4} />;
  return (
    <div className="space-y-6">
      <ProfileCard me={me.data} />
      <AppearanceCard />
      <InterestsCard me={me.data} />
      <NotificationsCard prefs={me.data.notifications} />
      <DataCard />
      <ActivityCard />
    </div>
  );
}

function ProfileCard({ me }: { me: MeResponse }) {
  const update = useUpdateProfile();
  const [name, setName] = useState(me.profile.display_name ?? "");
  const [tz, setTz] = useState(me.profile.timezone);
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [tz];
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function save(e: FormEvent) {
    e.preventDefault();
    update.mutate({ display_name: name.trim() || undefined, timezone: tz }, { onSuccess: () => undefined });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your time zone drives due dates, reminders and briefing times.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="display-name">Display name</Label>
            <Input id="display-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Time zone</Label>
            <Select value={tz} onValueChange={setTz}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {zones.map((z) => (
                  <SelectItem key={z} value={z}>
                    {z}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {browserTz !== tz && (
              <Button type="button" variant="link" size="xs" className="px-0" onClick={() => setTz(browserTz)}>
                Use this device&apos;s time zone ({browserTz})
              </Button>
            )}
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={update.isPending}>
              {update.isPending && <Spinner />} Save profile
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const update = useUpdatePreferences();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Dark mode is the default.</CardDescription>
      </CardHeader>
      <CardContent>
        <ToggleGroup
          type="single"
          variant="outline"
          value={theme}
          onValueChange={(v) => {
            if (!v) return;
            setTheme(v);
            update.mutate({ theme: v as "dark" | "light" | "system" });
          }}
        >
          <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
          <ToggleGroupItem value="light">Light</ToggleGroupItem>
          <ToggleGroupItem value="system">System</ToggleGroupItem>
        </ToggleGroup>
      </CardContent>
    </Card>
  );
}

function InterestsCard({ me }: { me: MeResponse }) {
  const update = useUpdatePreferences();
  const [cats, setCats] = useState<CategorySlug[]>(me.preferences.interest_categories);
  const [keywords, setKeywords] = useState(me.preferences.interest_keywords.join(", "));

  const toggle = (slug: CategorySlug) => setCats((cur) => (cur.includes(slug) ? cur.filter((c) => c !== slug) : [...cur, slug]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Interests</CardTitle>
        <CardDescription>Used to rank AI intelligence for you. Watchlist terms are included automatically.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {INTELLIGENCE_CATEGORIES.map((c) => (
            <button
              key={c.slug}
              type="button"
              title={c.description}
              aria-pressed={cats.includes(c.slug)}
              onClick={() => toggle(c.slug)}
              className={cn("rounded-full border px-3 py-1 text-sm transition-colors hover:bg-accent", cats.includes(c.slug) && "border-primary bg-primary/10 text-primary")}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          <Label htmlFor="keywords">Keywords</Label>
          <Input id="keywords" placeholder="qwen3, mcp, rag, next.js" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        </div>
        <Button
          disabled={update.isPending}
          onClick={() =>
            update.mutate(
              {
                interest_categories: cats,
                interest_keywords: [...new Set(keywords.split(",").map((k) => k.trim()).filter((k) => k.length >= 2))].slice(0, 50),
              },
              { onSuccess: () => undefined },
            )
          }
        >
          {update.isPending && <Spinner />} Save interests
        </Button>
      </CardContent>
    </Card>
  );
}

function NotificationsCard({ prefs }: { prefs: NotificationPreferences }) {
  const update = useUpdateNotificationPrefs();
  const set = (patch: Partial<NotificationPreferences>) => update.mutate(patch);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications & briefings</CardTitle>
        <CardDescription>Only what matters — tune what reaches you.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Daily briefing</p>
            <p className="text-xs text-muted-foreground">Generated each morning in your time zone.</p>
          </div>
          <div className="flex items-center gap-3">
            <Input
              type="time"
              className="w-28"
              defaultValue={prefs.daily_briefing_time.slice(0, 5)}
              onBlur={(e) => e.target.value && set({ daily_briefing_time: e.target.value })}
              aria-label="Daily briefing time"
            />
            <Switch checked={prefs.daily_briefing_enabled} onCheckedChange={(v) => set({ daily_briefing_enabled: v })} aria-label="Daily briefing" />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Weekly briefing</p>
            <p className="text-xs text-muted-foreground">Productivity summary, goal progress and the week&apos;s important releases.</p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={String(prefs.weekly_briefing_day)} onValueChange={(v) => set({ weekly_briefing_day: Number(v) })}>
              <SelectTrigger className="w-32" aria-label="Weekly briefing day">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((d, i) => (
                  <SelectItem key={d} value={String(i)}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Switch checked={prefs.weekly_briefing_enabled} onCheckedChange={(v) => set({ weekly_briefing_enabled: v })} aria-label="Weekly briefing" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Task reminders</p>
            <p className="text-xs text-muted-foreground">In-app notifications at each task&apos;s reminder time.</p>
          </div>
          <Switch checked={prefs.task_reminders_enabled} onCheckedChange={(v) => set({ task_reminders_enabled: v })} aria-label="Task reminders" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Watchlist alerts</p>
            <p className="text-xs text-muted-foreground">Minimum importance for an alert (0–100). Releases of watched repositories always alert.</p>
          </div>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={0}
              max={100}
              className="w-20"
              defaultValue={prefs.min_alert_relevance}
              onBlur={(e) => set({ min_alert_relevance: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
              aria-label="Minimum alert importance"
            />
            <Switch checked={prefs.watchlist_alerts_enabled} onCheckedChange={(v) => set({ watchlist_alerts_enabled: v })} aria-label="Watchlist alerts" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DataCard() {
  const exportData = useExportData();
  const deleteAccount = useDeleteAccount();
  const [confirm, setConfirm] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data & privacy</CardTitle>
        <CardDescription>
          Your data is protected by row-level security and processed by your own local models. Export everything at any time, or delete your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button variant="outline" disabled={exportData.isPending} onClick={() => exportData.mutate()}>
          {exportData.isPending ? <Spinner /> : <Download />} Export my data (JSON)
        </Button>
        <AlertDialog onOpenChange={() => setConfirm("")}>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">
              <Trash2 /> Delete account
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account permanently?</AlertDialogTitle>
              <AlertDialogDescription>
                This deletes all tasks, goals, knowledge, conversations, briefings, devices and integrations. It cannot be undone. Type <strong>DELETE MY ACCOUNT</strong> to confirm.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE MY ACCOUNT" />
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction disabled={confirm !== "DELETE MY ACCOUNT" || deleteAccount.isPending} onClick={() => deleteAccount.mutate()}>
                Delete everything
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

function ActivityCard() {
  const logs = useAuditLogs();
  const jobs = useJobs();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4" /> Activity
        </CardTitle>
        <CardDescription>Security-relevant events and recent background agent jobs.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Audit log</p>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto text-sm">
            {(logs.data ?? []).map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  <Badge variant="outline" className="mr-2 text-[10px]">
                    {l.actor}
                  </Badge>
                  {l.action}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(l.created_at)}</span>
              </li>
            ))}
            {logs.data?.length === 0 && <li className="text-muted-foreground">No events yet.</li>}
          </ul>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Background jobs</p>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto text-sm">
            {(jobs.data?.items ?? []).map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs">{j.kind}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <Badge
                    variant="outline"
                    className={cn("text-[10px]", j.status === "failed" && "border-destructive/40 text-destructive", j.status === "succeeded" && "text-success")}
                  >
                    {j.status}
                  </Badge>
                  {relativeTime(j.finished_at ?? j.created_at)}
                </span>
              </li>
            ))}
            {jobs.data?.items.length === 0 && <li className="text-muted-foreground">No jobs yet.</li>}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
