import type { Metadata } from "next";
import { FeedView } from "@/components/intelligence/feed-view";

export const metadata: Metadata = { title: "AI News" };

export default function AINewsPage() {
  return (
    <FeedView
      title="AI News"
      description="Announcements, model releases and products from AI labs, Hugging Face and the tech press — ranked for you."
      showCategories
      tabs={[
        { feed: "ai_news", label: "News", variant: "news" },
        { feed: "models", label: "Trending models", variant: "model" },
        { feed: "products", label: "Products", variant: "news" },
      ]}
    />
  );
}
