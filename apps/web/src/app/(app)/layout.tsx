import { Suspense } from "react";
import { PageContainer } from "@/components/common/page-header";
import { ListSkeleton } from "@/components/common/states";
import { AppShell } from "@/components/layout/app-shell";
import { Skeleton } from "@/components/ui/skeleton";

function PageFallback() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <ListSkeleton rows={6} />
    </PageContainer>
  );
}

/**
 * The shell (sidebar, header) is prerendered into the static shell; page content is
 * client-rendered and time-aware, so it streams in behind a Suspense boundary
 * (required by Cache Components for components that read the current time).
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell>
      <Suspense fallback={<PageFallback />}>{children}</Suspense>
    </AppShell>
  );
}
