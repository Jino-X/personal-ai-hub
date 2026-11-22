"use client";

import type { FeedItem } from "@hub/shared";
import { BookMarked, Copy, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useKnowledgeMutations } from "@/lib/api/hooks/knowledge";

/**
 * Extra per-item menu actions contributed by other modules (knowledge vault,
 * assistant). Rendered inside the item card's dropdown menu.
 */
export function ItemActions({ item }: { item: FeedItem }) {
  const { create } = useKnowledgeMutations();
  const router = useRouter();
  const prompt = `Explain "${item.title}" (${item.url}) — what it is, what's new, and why it matters to me.`;

  return (
    <>
      {/* A duplicate save surfaces the API's 409 ("already exists") via the global error toast. */}
      <DropdownMenuItem onSelect={() => create.mutate({ mode: "intelligence_item", item_id: item.id })}>
        <BookMarked /> Save to Knowledge Vault
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => router.push(`/assistant?prompt=${encodeURIComponent(prompt)}`)}>
        <Sparkles /> Ask the assistant
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() =>
          void navigator.clipboard.writeText(item.url).then(
            () => toast.success("Link copied"),
            () => toast.error("Couldn't copy the link"),
          )
        }
      >
        <Copy /> Copy link
      </DropdownMenuItem>
    </>
  );
}
