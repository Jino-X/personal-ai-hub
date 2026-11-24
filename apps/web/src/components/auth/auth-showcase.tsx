import type { CSSProperties, ReactNode } from "react";
import {
  Bot,
  BookmarkCheck,
  BrainCircuit,
  CalendarCheck,
  Cpu,
  Library,
  ListChecks,
  Lock,
  Newspaper,
  Radar,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DepthSurface } from "./depth-surface";

/** What the hub brings together, from the README's feature list. */
export const PILLARS = [
  { icon: ListChecks, title: "Productivity", text: "Tasks, goals, learning paths and a calendar, with AI that plans your day." },
  { icon: Radar, title: "AI & dev intelligence", text: "Models, papers, trending repos and releases, summarised and ranked for you." },
  { icon: Library, title: "Knowledge vault", text: "Save articles, repos and papers, then search and ask questions with citations." },
  { icon: Bot, title: "Assistant & briefings", text: "Chat over everything you keep, plus daily and weekly briefings." },
] as const;

/** A frosted card in the scene; `z` is how far it floats towards the viewer. */
function Layer({ z, className, style, children, delay = 0 }: { z: number; className?: string; style?: CSSProperties; children: ReactNode; delay?: number }) {
  return (
    <div className="depth-layer" style={{ "--z": `${z}px`, ...style } as CSSProperties}>
      <div
        className={cn(
          "animate-float rounded-2xl border border-white/10 bg-white/[0.06] p-4 text-white shadow-[0_30px_60px_-25px_rgb(0_0_0/0.8)] backdrop-blur-md",
          className,
        )}
        style={{ animationDelay: `${delay}ms` }}
      >
        {children}
      </div>
    </div>
  );
}

const Bar = ({ className }: { className?: string }) => <div className={cn("h-1.5 rounded-full bg-white/15", className)} />;

/**
 * The sign-in page's left half: the hub's surfaces as floating cards in a 3D scene that tilts towards
 * the pointer, over a receding grid, with what the hub does and how it keeps your data private.
 */
export function AuthShowcase() {
  return (
    <DepthSurface
      maxTilt={10}
      className="relative hidden h-svh flex-col overflow-hidden bg-[oklch(0.14_0.03_282)] px-10 py-9 text-white lg:sticky lg:top-0 lg:flex xl:px-14"
    >
      {/* Backdrop: drifting colour, a light that follows the pointer, and a grid floor */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="animate-drift absolute -top-1/4 -left-1/4 size-[70%] rounded-full bg-[oklch(0.55_0.22_282/0.45)] blur-[120px]" />
        <div className="animate-drift absolute -right-1/4 bottom-0 size-[60%] rounded-full bg-[oklch(0.6_0.16_200/0.3)] blur-[120px] [animation-delay:-9s]" />
        <div className="absolute inset-0 bg-[radial-gradient(600px_circle_at_var(--mx)_var(--my),oklch(0.75_0.15_282/0.16),transparent_60%)] transition-[background] duration-300" />
        <div className="absolute inset-x-[-50%] top-[58%] h-[80%] [perspective:600px]">
          <div className="depth-floor animate-grid-flow size-full" />
        </div>
      </div>

      <div className="relative flex items-center gap-2.5">
        <div className="flex size-9 items-center justify-center rounded-xl bg-white text-[oklch(0.3_0.15_282)] shadow-lg shadow-black/30">
          <BrainCircuit className="size-5" />
        </div>
        <span className="font-semibold tracking-tight">Personal AI Hub</span>
      </div>

      {/* The scene */}
      <div className="depth-perspective relative flex min-h-0 flex-1 items-center justify-center py-4 [@media(max-height:620px)]:hidden">
        <div className="auth-scene depth-stage relative h-[390px] w-[500px]">
          <Layer z={0} style={{ left: 0, top: 56, width: 270 }}>
            <div className="flex items-center justify-between text-xs text-white/60">
              <span className="flex items-center gap-1.5">
                <CalendarCheck className="size-3.5" /> Daily briefing
              </span>
              <span>08:00</span>
            </div>
            <p className="mt-2 text-sm font-medium">Good morning. 3 tasks due today, 1 urgent.</p>
            <div className="mt-3 space-y-2">
              <Bar className="w-11/12" />
              <Bar className="w-3/4" />
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-white/60">
              <span>Goal · Ship v1</span>
              <span>68%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-[68%] rounded-full bg-gradient-to-r from-[oklch(0.72_0.15_282)] to-[oklch(0.75_0.13_200)]" />
            </div>
          </Layer>

          <Layer z={70} delay={-1800} style={{ right: 0, top: 0, width: 240 }}>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="rounded-full bg-[oklch(0.72_0.15_282/0.25)] px-2 py-0.5 font-medium text-[oklch(0.88_0.07_282)]">LLM</span>
              <span className="flex items-center gap-1 text-white/50">
                <Newspaper className="size-3" /> AI news
              </span>
              <span className="ml-auto font-semibold text-[oklch(0.85_0.13_155)]">9.2</span>
            </div>
            <p className="mt-2 text-sm leading-snug font-medium">New open-weight reasoning model tops coding benchmarks</p>
            <p className="mt-2 flex items-center gap-1 text-[11px] text-white/50">
              <Sparkles className="size-3" /> AI summary · why it matters
            </p>
            <div className="mt-2 space-y-1.5">
              <Bar className="w-full" />
              <Bar className="w-2/3" />
            </div>
          </Layer>

          <Layer z={45} delay={-3600} style={{ right: 30, top: 178, width: 196 }} className="px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-xs">
              <BookmarkCheck className="size-3.5 text-[oklch(0.85_0.13_155)]" /> Saved to Knowledge vault
            </p>
          </Layer>

          <Layer z={110} delay={-900} style={{ left: 16, top: 256, width: 236 }} className="px-3.5 py-3">
            <p className="text-[11px] text-white/50">GitHub Trending</p>
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="font-mono text-[13px]">agent-orchestrator</span>
              <span className="flex items-center gap-1 text-xs text-[oklch(0.85_0.14_80)]">
                <Star className="size-3 fill-current" /> 2.4k
              </span>
            </div>
          </Layer>

          <Layer z={150} delay={-2700} style={{ right: 0, top: 236, width: 236 }} className="space-y-2 p-3">
            <p className="ml-auto w-fit rounded-xl rounded-br-sm bg-white/90 px-3 py-1.5 text-xs font-medium text-[oklch(0.25_0.05_282)]">
              Plan my day
            </p>
            <div className="flex gap-2">
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[oklch(0.72_0.15_282/0.3)]">
                <Bot className="size-3.5" />
              </div>
              <p className="rounded-xl rounded-tl-sm bg-white/10 px-3 py-1.5 text-xs leading-relaxed text-white/85">
                Deep work 9–11 on the API, then the two papers you saved yesterday.
              </p>
            </div>
          </Layer>

          <Layer z={190} delay={-4500} style={{ left: 60, bottom: -6 }} className="rounded-full px-3.5 py-2">
            <p className="flex items-center gap-2 text-xs font-medium">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[oklch(0.8_0.16_155)] opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-[oklch(0.8_0.16_155)]" />
              </span>
              <Cpu className="size-3.5 text-white/70" /> qwen3:8b · running on your Mac
            </p>
          </Layer>
        </div>
      </div>

      <div className="relative max-w-xl">
        <h2 className="text-3xl leading-tight font-semibold tracking-tight text-balance xl:text-4xl">
          Your second brain,{" "}
          <span className="bg-gradient-to-r from-[oklch(0.82_0.12_282)] to-[oklch(0.82_0.11_200)] bg-clip-text text-transparent">
            on your own models.
          </span>
        </h2>
        <p className="mt-3 text-sm text-white/65">
          Productivity, AI and developer intelligence, and a knowledge vault in one place, with AI that runs on your Mac
          through Ollama.
        </p>

        <ul className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4">
          {PILLARS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06]">
                <Icon className="size-4 text-[oklch(0.85_0.09_282)]" />
              </span>
              <div>
                <p className="text-sm font-medium">{title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-white/55 [@media(max-height:840px)]:hidden">{text}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-t border-white/10 pt-4 text-xs text-white/55">
          <span className="flex items-center gap-1.5">
            <Cpu className="size-3.5" /> Local inference via Ollama
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" /> Ollama is never exposed
          </span>
          <span className="flex items-center gap-1.5">
            <Lock className="size-3.5" /> Row-level security on your data
          </span>
        </div>
      </div>
    </DepthSurface>
  );
}
