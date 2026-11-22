import type { Metadata } from "next";
import { FeedView } from "@/components/intelligence/feed-view";

export const metadata: Metadata = { title: "GitHub Trending" };

export default function GitHubTrendingPage() {
  return (
    <FeedView
      title="GitHub Trending"
      description="Repositories trending on GitHub today (all languages, Python and TypeScript). Metrics are exactly as reported by GitHub."
      defaultSort="popular"
      tabs={[{ feed: "github_trending", label: "Trending", variant: "repo" }]}
    />
  );
}
