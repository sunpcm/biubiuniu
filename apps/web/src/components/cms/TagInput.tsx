"use client";

import { Badge } from "@niu/ui/badge";
import { Button } from "@niu/ui/button";
import { PostType } from "@niu/db/schema";
import { useTagStore } from "@/stores/tagStore";
import { Tag } from "@/types/cms";
import { Tag as TagIcon, X } from "lucide-react";
import { useEffect, useState } from "react";
import { TagSelectDialog } from "./TagSelectDialog";

export type FormTag = {
  id: string;
  name: string;
};

interface TagInputProps {
  value: FormTag[];
  onChange: (value: FormTag[]) => void;
  disabled?: boolean;
  postType: PostType;
}

export function TagInput({ value, onChange, disabled, postType }: TagInputProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { tags, isLoading, fetchTags, addTag } = useTagStore();
  const availableTags = tags[postType] || [];
  const isLoadingTags = isLoading[postType] ?? true;

  // Initial load
  useEffect(() => {
    fetchTags(postType);
  }, [postType]);

  const handleDeselectTag = (tagId: string) => {
    onChange(value.filter((t) => t.id !== tagId));
  };

  const handleTagCreated = (tag: Tag) => {
    addTag(postType, tag);
  };

  return (
    <div className="w-full">
      <div className="mb-2 flex min-h-[40px] flex-wrap items-center gap-2 rounded-md border p-2">
        {value?.map((tag) => (
          <Badge key={tag.id}>
            {tag.name}
            <button
              type="button"
              className="ring-offset-background focus:ring-ring ml-1 rounded-full outline-none focus:ring-2 focus:ring-offset-2"
              onClick={() => handleDeselectTag(tag.id)}
              aria-label={`Remove ${tag.name}`}
              disabled={disabled}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsDialogOpen(true)}
          disabled={disabled}
          className="ml-auto shrink-0"
        >
          <TagIcon className="mr-2 h-4 w-4" />
          Select Tags
        </Button>
      </div>

      <TagSelectDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        selectedTags={value || []}
        onTagsChange={onChange}
        initialAvailableTags={availableTags}
        isLoadingInitialTags={isLoadingTags}
        postType={postType}
        onGlobalTagCreated={handleTagCreated}
      />
    </div>
  );
}
