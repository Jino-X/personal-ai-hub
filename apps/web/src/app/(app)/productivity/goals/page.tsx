import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer } from "@/components/common/page-header";
import { CardGridSkeleton } from "@/components/common/states";
import { GoalsView } from "@/components/productivity/goals-view";

export const metadata: Metadata = { title: "Goals & Learning" };

export default function GoalsPage() {
  return (
    <Suspense
      fallback={
        <PageContainer>
          <CardGridSkeleton />
        </PageContainer>
      }
    >
      <GoalsView />
    </Suspense>
  );
}
