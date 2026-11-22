import type { Metadata } from "next";
import { PageContainer, PageHeader } from "@/components/common/page-header";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <PageContainer>
      <PageHeader title="Dashboard" description="Your day at a glance." />
    </PageContainer>
  );
}
