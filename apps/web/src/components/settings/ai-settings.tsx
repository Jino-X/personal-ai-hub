"use client";

import { AI_PROVIDERS, type AIProviderSetting, type AISettings, type LocalAIDevice, type PairingCode } from "@hub/shared";
import { Check, Copy, Cpu, KeyRound, Laptop, Pencil, PlugZap, ShieldCheck, Trash2, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ErrorState, ListSkeleton } from "@/components/common/states";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  useAISettings,
  useAvailableModels,
  useDeviceMutations,
  useDevices,
  useTestAI,
  useUpdateAISettings,
  type AISettingsResponse,
} from "@/lib/api/hooks/settings";
import { useAIStatus } from "@/lib/api/hooks/system";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const PROVIDER_LABEL: Record<AIProviderSetting, string> = {
  auto: "Automatic (companion → Ollama → cloud if allowed)",
  companion: "Local AI companion",
  ollama: "Ollama (direct, same host)",
  openai_compatible: "Cloud (OpenAI-compatible)",
};

export function AISettingsPanel() {
  return (
    <div className="space-y-6">
      <StatusCard />
      <DevicesCard />
      <ModelSettingsCard />
    </div>
  );
}

function StatusCard() {
  const status = useAIStatus();
  const test = useTestAI();
  const s = status.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="size-4" /> Local AI status
        </CardTitle>
        <CardDescription>Inference runs on your Mac through Ollama. The companion connects outbound, so Ollama is never exposed to the internet.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status.isPending ? (
          <ListSkeleton rows={1} />
        ) : status.isError ? (
          <ErrorState compact error={status.error} onRetry={() => void status.refetch()} />
        ) : (
          s && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span className={cn("size-2.5 rounded-full", s.available ? (s.chat_model_available ? "bg-success" : "bg-warning") : "bg-destructive")} />
                <span className="font-medium">{s.available ? `Available via ${s.provider === "companion" ? "companion" : s.provider === "ollama" ? "direct Ollama" : "cloud"}` : "Unavailable"}</span>
                {!s.available && s.reason && <span className="text-sm text-muted-foreground">{s.reason}</span>}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {s.providers.map((p) => (
                  <div key={p.id} className="rounded-lg border p-3 text-sm">
                    <p className="font-medium">{p.id === "companion" ? "Companion" : p.id === "ollama" ? "Direct Ollama" : "Cloud"}</p>
                    <p className="text-xs text-muted-foreground">{!p.configured ? "Not configured" : p.available ? "Ready" : (p.detail ?? "Unavailable")}</p>
                  </div>
                ))}
              </div>
            </>
          )
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? <Spinner /> : <Zap />} Test connection
          </Button>
          {test.isError && <ErrorState compact error={test.error} />}
          {test.data && (
            <p className="text-sm text-muted-foreground">
              <Check className="mr-1 inline size-4 text-success" />
              {test.data.model} replied “{test.data.reply}” in {test.data.latency_ms} ms ·{" "}
              {test.data.embedding.ok ? `embeddings ${test.data.embedding.dimensions}-dim in ${test.data.embedding.latency_ms} ms` : `embeddings failed: ${test.data.embedding.error}`}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DevicesCard() {
  const devices = useDevices();
  const { pairingCode, revoke } = useDeviceMutations();
  const [code, setCode] = useState<PairingCode | null>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Laptop className="size-4" /> Devices
          </CardTitle>
          <CardDescription>Macs running the companion. Each device authenticates with short-lived tokens and can be revoked instantly.</CardDescription>
        </div>
        <Button disabled={pairingCode.isPending} onClick={() => pairingCode.mutate(undefined, { onSuccess: setCode })}>
          {pairingCode.isPending ? <Spinner /> : <PlugZap />} Pair a device
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {devices.isPending ? (
          <ListSkeleton rows={2} />
        ) : (devices.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No devices paired yet. Pair your Mac to enable local inference.</p>
        ) : (
          (devices.data ?? []).map((d) => <DeviceRow key={d.id} device={d} onRevoke={() => confirm(`Revoke "${d.name}"? It will be disconnected immediately.`) && revoke.mutate(d.id)} />)
        )}
      </CardContent>
      <PairingDialog code={code} onClose={() => setCode(null)} />
    </Card>
  );
}

function DeviceRow({ device: d, onRevoke }: { device: LocalAIDevice; onRevoke: () => void }) {
  const { rename } = useDeviceMutations();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(d.name);
  const health = d.health;

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("size-2 rounded-full", d.online ? (health.ollama_reachable ? "bg-success" : "bg-warning") : "bg-muted-foreground")} />
        {editing ? (
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              rename.mutate({ id: d.id, name }, { onSuccess: () => setEditing(false) });
            }}
          >
            <Input className="h-7 w-48" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            <Button size="xs" type="submit">
              Save
            </Button>
          </form>
        ) : (
          <span className="font-medium">{d.name}</span>
        )}
        <Badge variant="outline" className="text-[10px]">
          {d.online ? (health.ollama_reachable ? "online" : "online · Ollama not running") : d.last_seen_at ? `last seen ${relativeTime(d.last_seen_at)}` : "never connected"}
        </Badge>
        <div className="ml-auto flex gap-1">
          <Button size="icon-xs" variant="ghost" aria-label="Rename device" onClick={() => setEditing((v) => !v)}>
            <Pencil />
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="Revoke device" onClick={onRevoke}>
            <Trash2 />
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {[d.platform, d.companion_version && `companion ${d.companion_version}`, health.ollama_version && `Ollama ${health.ollama_version}`].filter(Boolean).join(" · ")}
      </p>
      {health.models && health.models.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {health.models.map((m) => (
            <Badge key={m.name} variant="secondary" className={cn("font-mono text-[10px]", health.running_models?.includes(m.name) && "border-success/50")}>
              {m.name}
              {m.parameter_size ? ` · ${m.parameter_size}` : ""}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function CopyLine({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/50 py-1.5 pr-1.5 pl-3 font-mono text-xs leading-5">
      {/* Long commands (the pairing one) wrap inside the box rather than widening the dialog */}
      <code className="min-w-0 flex-1 py-0.5 [overflow-wrap:anywhere]">{text}</code>
      <Button
        size="icon-xs"
        variant="ghost"
        className="shrink-0"
        aria-label="Copy"
        onClick={() => void navigator.clipboard.writeText(text).then(() => toast.success("Copied"))}
      >
        <Copy />
      </Button>
    </div>
  );
}

function PairingDialog({ code, onClose }: { code: PairingCode | null; onClose: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!code) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [code]);
  const remaining = code ? Math.max(0, Math.round((new Date(code.expires_at).getTime() - now) / 1000)) : 0;

  return (
    <Dialog open={code !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" /> Pair a device
          </DialogTitle>
          <DialogDescription>Run these on the Mac with Ollama. The code works once and expires in 10 minutes.</DialogDescription>
        </DialogHeader>
        {code && (
          // min-w-0: as a grid item the body would otherwise grow to its widest line instead of the dialog's width
          <div className="min-w-0 space-y-4 text-sm">
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-4">
              <span className="font-mono text-2xl font-semibold tracking-widest">{code.code}</span>
              <span className={cn("text-xs tabular-nums", remaining < 60 ? "text-destructive" : "text-muted-foreground")}>
                {remaining > 0 ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : "expired"}
              </span>
            </div>
            <ol className="list-decimal space-y-3 pl-5">
              <li className="space-y-1.5">
                <p>Install Ollama and the default models:</p>
                <CopyLine text="ollama pull qwen3:8b && ollama pull qwen3-embedding:0.6b" />
              </li>
              <li className="space-y-1.5">
                <p>Install the companion (from the repository root):</p>
                <CopyLine text="uv tool install ./apps/companion" />
              </li>
              <li className="space-y-1.5">
                <p>Pair and start it:</p>
                <CopyLine text={code.command} />
                <CopyLine text="hub-companion run" />
              </li>
            </ol>
            <Alert>
              <ShieldCheck />
              <AlertDescription>The companion only makes outbound connections to {code.server_url}; nothing on your Mac is exposed.</AlertDescription>
            </Alert>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ModelSettingsCard() {
  const settings = useAISettings();
  if (!settings.data) return <ListSkeleton rows={3} />;
  return <ModelSettingsForm saved={settings.data.settings} server={settings.data.server} />;
}

function ModelSettingsForm({ saved, server }: { saved: AISettings; server: AISettingsResponse["server"] }) {
  const models = useAvailableModels();
  const update = useUpdateAISettings();
  const [draft, setDraft] = useState<AISettings>(saved);
  const installed = (models.data?.models ?? []).map((m) => m.name);
  const embeddingChanged = draft.embedding_model !== saved.embedding_model;
  const set = <K extends keyof AISettings>(key: K, value: AISettings[K]) => setDraft({ ...draft, [key]: value });

  const modelField = (id: "chat_model" | "embedding_model", label: string, hint: string) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} list={`${id}-options`} className="font-mono" value={draft[id]} onChange={(e) => set(id, e.target.value)} />
      <datalist id={`${id}-options`}>
        {installed.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <p className="text-xs text-muted-foreground">
        {hint}
        {installed.length > 0 && !installed.some((m) => m === draft[id] || m.startsWith(`${draft[id]}-`) || m === `${draft[id]}:latest`) && (
          <span className="text-warning"> Not installed on your device — run: ollama pull {draft[id]}</span>
        )}
      </p>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Models</CardTitle>
        <CardDescription>Provider routing, models and generation limits. The embedding model must produce at least {server.embedding_dimensions} dimensions.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label>Provider</Label>
          <Select value={draft.provider} onValueChange={(v) => set("provider", v as AIProviderSetting)}>
            <SelectTrigger className="w-full sm:w-96">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_PROVIDERS.map((p) => (
                <SelectItem key={p} value={p} disabled={(p === "ollama" && !server.ollama_direct) || (p === "openai_compatible" && !server.cloud)}>
                  {PROVIDER_LABEL[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {modelField("chat_model", "Chat model", "Used for summaries, the assistant and briefings (default qwen3:8b).")}
          {modelField("embedding_model", "Embedding model", "Used for knowledge vault search (default qwen3-embedding:0.6b).")}
        </div>
        {embeddingChanged && (
          <Alert>
            <AlertDescription>Changing the embedding model re-indexes your whole knowledge vault in the background.</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ctx">Context length (tokens)</Label>
            <Input id="ctx" type="number" min={2048} max={131072} step={1024} value={draft.context_length} onChange={(e) => set("context_length", Number(e.target.value))} />
            <p className="text-xs text-muted-foreground">Larger contexts use more memory on your Mac.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="temp">Temperature</Label>
            <Input id="temp" type="number" min={0} max={2} step={0.1} value={draft.temperature} onChange={(e) => set("temperature", Number(e.target.value))} />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Reasoning by default</p>
            <p className="text-xs text-muted-foreground">Qwen3 “thinking” mode for assistant answers — better on hard questions, slower.</p>
          </div>
          <Switch checked={draft.thinking} onCheckedChange={(v) => set("thinking", v)} aria-label="Reasoning by default" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Allow cloud fallback</p>
            <p className="text-xs text-muted-foreground">
              {server.cloud ? `When local AI is offline, use the server's cloud provider (${server.cloud_chat_model ?? "configured model"}). Your data leaves your devices.` : "No cloud provider is configured on the server."}
            </p>
          </div>
          <Switch checked={draft.allow_cloud_fallback} disabled={!server.cloud} onCheckedChange={(v) => set("allow_cloud_fallback", v)} aria-label="Allow cloud fallback" />
        </div>
        <Button
          disabled={update.isPending}
          onClick={() =>
            update.mutate(
              {
                provider: draft.provider,
                chat_model: draft.chat_model.trim(),
                embedding_model: draft.embedding_model.trim(),
                context_length: draft.context_length,
                temperature: draft.temperature,
                thinking: draft.thinking,
                allow_cloud_fallback: draft.allow_cloud_fallback,
              },
              { onSuccess: (r) => setDraft(r.settings) },
            )
          }
        >
          {update.isPending && <Spinner />} Save AI settings
        </Button>
      </CardContent>
    </Card>
  );
}
