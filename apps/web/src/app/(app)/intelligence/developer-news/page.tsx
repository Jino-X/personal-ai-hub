import type { Metadata } from "next";
import { FeedView } from "@/components/intelligence/feed-view";

export const metadata: Metadata = { title: "Developer News" };

export default function DeveloperNewsPage() {
  return (
    <FeedView
      title="Developer News"
      description="Releases, changelogs and blog posts for React, Next.js, Node.js, Python, FastAPI, PostgreSQL, Supabase, AWS, AI frameworks, MCP and local LLM tools."
      showTechnologies
      defaultSort="newest"
      tabs={[{ feed: "developer", label: "Releases & changelogs", variant: "release" }]}
    />
  );
}
