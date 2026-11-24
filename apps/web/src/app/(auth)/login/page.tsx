import type { Metadata } from "next";
import { Suspense } from "react";
import { BrainCircuit, Cpu } from "lucide-react";
import { AuthShowcase, PILLARS } from "@/components/auth/auth-showcase";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="grid min-h-svh lg:grid-cols-[1.15fr_1fr]">
      <AuthShowcase />

      <main className="relative flex min-h-svh flex-col overflow-hidden px-4 py-8 sm:px-8">
        {/* A faint dot grid and glow, so the form side has depth without competing with the scene */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--color-border)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)] bg-[size:22px_22px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/4 left-1/2 size-[480px] -translate-x-1/2 rounded-full bg-primary/15 blur-[120px]"
        />

        <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
          {/* Phones and tablets: the showcase's essentials above the form */}
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2.5">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
                <BrainCircuit className="size-5" />
              </div>
              <span className="text-lg font-semibold tracking-tight">Personal AI Hub</span>
            </div>
            <h2 className="mt-5 text-2xl leading-tight font-semibold tracking-tight text-balance">
              Your second brain, <span className="text-primary">on your own models.</span>
            </h2>
            <ul className="mt-5 grid grid-cols-2 gap-2">
              {PILLARS.map(({ icon: Icon, title }) => (
                <li key={title} className="flex items-center gap-2 rounded-lg border bg-card/60 px-3 py-2 text-xs font-medium backdrop-blur-sm">
                  <Icon className="size-3.5 shrink-0 text-primary" /> {title}
                </li>
              ))}
            </ul>
          </div>

          <Suspense>
            <LoginForm />
          </Suspense>

          <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Cpu className="size-3.5" /> Your AI runs on your Mac. Nothing is sent to third-party models unless you turn it on.
          </p>
        </div>
      </main>
    </div>
  );
}
