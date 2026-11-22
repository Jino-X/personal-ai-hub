import type { Metadata } from "next";
import { FeedView } from "@/components/intelligence/feed-view";

export const metadata: Metadata = { title: "Research" };

export default function ResearchPage() {
  return (
    <FeedView
      title="Research"
      description="Hugging Face Daily Papers and new arXiv submissions in AI, NLP and machine learning, with plain-language AI summaries."
      showCategories
      tabs={[{ feed: "research", label: "Papers", variant: "paper" }]}
    />
  );
}
