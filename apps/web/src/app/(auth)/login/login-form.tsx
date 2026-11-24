"use client";

import { ArrowRight, Eye, EyeOff, Mail } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DepthSurface } from "@/components/auth/depth-surface";
import { isConfigured } from "@/lib/env";
import { getSupabase } from "@/lib/supabase/client";

const HEADINGS = {
  signin: { title: "Welcome back", text: "Sign in to pick up where you left off." },
  signup: { title: "Create your hub", text: "One account for your tasks, intelligence feeds and knowledge vault." },
  magic: { title: "Sign in with a link", text: "No password needed: we'll email you a one-time link." },
} as const;

function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [mode, setMode] = useState<"signin" | "signup" | "magic">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(params.get("error") ? "Sign-in link was invalid or expired." : null);

  const redirectTo = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    const supabase = getSupabase();
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo() } });
        if (error) throw error;
        if (data.session) {
          router.replace(next);
          router.refresh();
        } else {
          toast.success("Check your inbox to confirm your email.");
        }
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo(), shouldCreateUser: false } });
        if (error) throw error;
        toast.success("Magic link sent — check your inbox.");
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setPending(false);
    }
  }

  if (!isConfigured) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in apps/web/.env.local.
        </AlertDescription>
      </Alert>
    );
  }

  const passwordToggle = (
    <button
      type="button"
      onClick={() => setShowPassword((v) => !v)}
      aria-label={showPassword ? "Hide password" : "Show password"}
      aria-pressed={showPassword}
      className="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </button>
  );
  const heading = HEADINGS[mode];

  return (
    <DepthSurface maxTilt={5} className="depth-perspective">
      <div className="depth-stage relative rounded-2xl border bg-card/80 p-6 shadow-[0_40px_80px_-40px_rgb(0_0_0/0.55)] backdrop-blur-xl focus-within:shadow-[0_60px_120px_-40px_color-mix(in_oklch,var(--color-primary)_45%,transparent)] sm:p-8">
        <div aria-hidden className="depth-sheen" />
        {/* A hairline of light along the top edge */}
        <div aria-hidden className="pointer-events-none absolute inset-x-8 -top-px h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

        <div key={mode} className="relative mb-6 animate-in duration-300 fade-in slide-in-from-bottom-1">
          <h1 className="text-2xl font-semibold tracking-tight">{heading.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{heading.text}</p>
        </div>

        <Tabs
          value={mode}
          onValueChange={(v) => {
            setMode(v as typeof mode);
            setMessage(null);
          }}
          className="relative"
        >
          <TabsList className="mb-6 grid w-full grid-cols-3">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Sign up</TabsTrigger>
            <TabsTrigger value="magic">Magic link</TabsTrigger>
          </TabsList>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                className="h-10"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <TabsContent value="signin" className="mt-0 space-y-2 animate-in duration-300 fade-in">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  className="h-10 pr-10"
                  required={mode === "signin"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {passwordToggle}
              </div>
            </TabsContent>
            <TabsContent value="signup" className="mt-0 space-y-2 animate-in duration-300 fade-in">
              <Label htmlFor="new-password">Password</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className="h-10 pr-10"
                  minLength={8}
                  required={mode === "signup"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {passwordToggle}
              </div>
              <p className="text-xs text-muted-foreground">At least 8 characters.</p>
            </TabsContent>
            <TabsContent value="magic" className="mt-0 animate-in duration-300 fade-in">
              <p className="rounded-lg border border-dashed bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                For existing accounts. Open the link on this device to sign straight in.
              </p>
            </TabsContent>
            {message && (
              <Alert variant="destructive" className="animate-in fade-in slide-in-from-top-1">
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            )}
            <Button
              type="submit"
              className="group h-11 w-full text-sm shadow-lg shadow-primary/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/30 active:translate-y-0 active:scale-[0.99] active:shadow-md"
              disabled={pending}
            >
              {pending ? <Spinner /> : mode === "magic" ? <Mail /> : null}
              {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send magic link"}
              {!pending && mode !== "magic" && <ArrowRight className="transition-transform group-hover:translate-x-0.5" />}
            </Button>
          </form>
        </Tabs>
      </div>
    </DepthSurface>
  );
}
