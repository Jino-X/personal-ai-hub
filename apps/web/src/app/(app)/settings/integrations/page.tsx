import type { Metadata } from "next";
import { IntegrationsPanel } from "@/components/settings/integrations-settings";

export const metadata: Metadata = { title: "Integrations" };

export default function IntegrationsPage() {
  return <IntegrationsPanel />;
}
