"use client";

import { cn } from "@niu/utils";
import { Tag } from "@/types/cms";

interface TagSelectorProps {
  tags: Tag[];
  selectedTagId: string | null;
  onSelectTag: (tagId: string | null) => void;
}

export function TagSelector({ tags, selectedTagId, onSelectTag }: TagSelectorProps) {
  return (
    <div className="mb-6 flex flex-wrap justify-center gap-2">
      <button
        onClick={() => onSelectTag(null)}
        className={cn(
          "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
          selectedTagId === null
            ? "bg-primary text-primary-foreground"
            : "bg-secondary hover:bg-secondary/80 text-secondary-foreground",
        )}
      >
        All
      </button>

      {tags.map((tag) => (
        <button
          key={tag.id}
          onClick={() => onSelectTag(tag.id)}
          className={cn(
            "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
            selectedTagId === tag.id
              ? "bg-primary text-primary-foreground"
              : "bg-secondary hover:bg-secondary/80 text-secondary-foreground",
          )}
        >
          {tag.name}
        </button>
      ))}
    </div>
  );
}
