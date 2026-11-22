import type { Metadata } from "next";
import { AISettingsPanel } from "@/components/settings/ai-settings";

export const metadata: Metadata = { title: "AI settings" };

export default function AISettingsPage() {
  return <AISettingsPanel />;
}
