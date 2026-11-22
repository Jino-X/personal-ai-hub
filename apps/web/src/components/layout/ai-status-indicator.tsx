"use client";

import { Cpu } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAIStatus } from "@/lib/api/hooks/system";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const PROVIDER_LABEL = { companion: "Local companion", ollama: "Ollama (direct)", openai_compatible: "Cloud provider" } as const;

/** Header indicator for local model availability (PRD: "local model availability indicator"). */
export function AIStatusIndicator() {
  const { data, isPending, isError } = useAIStatus();
  const tone = isPending ? "pending" : isError || !data?.available ? "offline" : data.chat_model_available ? "online" : "degraded";
  const label = { pending: "Checking local AI…", offline: "Local AI offline", degraded: "Model missing", online: "Local AI online" }[tone];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2" aria-label={label}>
          <span className="relative flex size-2">
            {tone === "online" && <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />}
            <span
              className={cn(
                "relative inline-flex size-2 rounded-full",
                tone === "online" && "bg-success",
                tone === "degraded" && "bg-warning",
                tone === "offline" && "bg-destructive",
                tone === "pending" && "bg-muted-foreground",
              )}
            />
          </span>
          <Cpu className="size-4" />
          <span className="hidden text-xs lg:inline">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="space-y-3 text-sm">
          <div>
            <p className="font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">
              {data?.available
                ? `${PROVIDER_LABEL[data.provider!]} · ${data.settings.chat_model}`
                : (data?.reason ?? "Start the AI companion on your Mac to enable summaries, the assistant and briefings.")}
            </p>
          </div>
          {data && (
            <ul className="space-y-1.5 text-xs">
              <li className="flex justify-between">
                <span className="text-muted-foreground">Chat model</span>
                <span className={data.chat_model_available ? "" : "text-warning"}>{data.settings.chat_model}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted-foreground">Embedding model</span>
                <span className={data.embedding_model_available ? "" : "text-warning"}>{data.settings.embedding_model}</span>
              </li>
              {data.devices.map((d) => (
                <li key={d.id} className="flex justify-between">
                  <span className="text-muted-foreground">{d.name}</span>
                  <span>{d.online ? "online" : d.last_seen_at ? `seen ${relativeTime(d.last_seen_at)}` : "never connected"}</span>
                </li>
              ))}
            </ul>
          )}
          <Button asChild size="sm" variant="outline" className="w-full">
            <Link href="/settings/ai">AI settings</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
