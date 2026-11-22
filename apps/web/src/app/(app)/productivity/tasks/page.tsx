import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer } from "@/components/common/page-header";
import { ListSkeleton } from "@/components/common/states";
import { TasksView } from "@/components/productivity/tasks-view";

export const metadata: Metadata = { title: "Tasks" };

export default function TasksPage() {
  return (
    <Suspense
      fallback={
        <PageContainer>
          <ListSkeleton rows={8} />
        </PageContainer>
      }
    >
      <TasksView />
    </Suspense>
  );
}
