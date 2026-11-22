import type { Metadata } from "next";
import { BriefingsView } from "@/components/briefings/briefings-view";

export const metadata: Metadata = { title: "Briefings" };

export default function BriefingsPage() {
  return <BriefingsView />;
}
