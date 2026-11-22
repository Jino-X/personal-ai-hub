import type { Metadata } from "next";
import { Suspense } from "react";
import { BrainCircuit } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--color-primary)/0.18,transparent_60%)]"
      />
      <div className="relative w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <BrainCircuit className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Personal AI Hub</h1>
            <p className="text-sm text-muted-foreground">Productivity, AI intelligence and knowledge — on your own models.</p>
          </div>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
