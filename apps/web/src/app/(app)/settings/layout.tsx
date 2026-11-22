import { PageContainer, PageHeader } from "@/components/common/page-header";
import { SettingsNav } from "@/components/settings/settings-nav";

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <PageContainer>
      <PageHeader title="Settings" description="Profile, notifications, local AI and integrations." />
      <SettingsNav />
      {children}
    </PageContainer>
  );
}
