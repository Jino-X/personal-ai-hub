"use client";

import type { FeedItem } from "@hub/shared";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

/**
 * Extra per-item menu actions contributed by other modules (knowledge vault,
 * assistant). Rendered inside the item card's dropdown menu.
 */
export function ItemActions({ item }: { item: FeedItem }) {
  return (
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
  );
}
