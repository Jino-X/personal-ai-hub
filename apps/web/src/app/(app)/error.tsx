"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60svh] flex-col items-center justify-center gap-4 p-6 text-center">
      <CircleAlert className="size-10 text-destructive" />
      <div className="max-w-md space-y-1">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">{error.message || "An unexpected error occurred while rendering this page."}</p>
        {error.digest && <p className="font-mono text-xs text-muted-foreground">ref: {error.digest}</p>}
      </div>
      <Button variant="outline" onClick={reset}>
        <RefreshCw /> Try again
      </Button>
    </div>
  );
}
