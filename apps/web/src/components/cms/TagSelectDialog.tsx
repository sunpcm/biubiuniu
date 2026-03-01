"use client";

import { createTagAction } from "@/actions/posts/tags";
import { Badge } from "@niu/ui/badge";
import { Button } from "@niu/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@niu/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@niu/ui/dialog";
import { PostType } from "@/lib/db/schema";
import { Tag } from "@/types/cms";
import { Check, Loader2, Plus, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

const MAX_TAGS_LIMIT = 5;

export type FormTag = {
  id: string;
  name: string;
};

interface TagSelectDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  selectedTags: FormTag[];
  onTagsChange: (tags: FormTag[]) => void;
  initialAvailableTags: Tag[];
  isLoadingInitialTags: boolean;
  postType: PostType;
  onGlobalTagCreated?: (tag: Tag) => void;
}

export function TagSelectDialog({
  isOpen,
  onOpenChange,
  selectedTags,
  onTagsChange,
  initialAvailableTags,
  isLoadingInitialTags,
  postType,
  onGlobalTagCreated,
}: TagSelectDialogProps) {
  const [currentAvailableTags, setCurrentAvailableTags] = useState<Tag[]>(initialAvailableTags);
  const [searchTerm, setSearchTerm] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setCurrentAvailableTags(initialAvailableTags);
  }, [initialAvailableTags]);

  const handleSelectTag = (tag: Tag) => {
    const isSelected = selectedTags.some((t) => t.id === tag.id);

    if (isSelected) {
      onTagsChange(selectedTags.filter((t) => t.id !== tag.id));
    } else {
      if (selectedTags.length >= MAX_TAGS_LIMIT) {
        toast.info(`You can only select up to ${MAX_TAGS_LIMIT} tags.`);
        return;
      }
      onTagsChange([
        ...selectedTags,
        {
          id: tag.id,
          name: tag.name,
        },
      ]);
    }
  };

  const handleCreateTag = async () => {
    if (!searchTerm.trim()) return;

    startTransition(async () => {
      try {
        const result = await createTagAction({
          name: searchTerm.trim(),
          postType,
        });
        if (result.success && result.data?.tag) {
          const newTag = result.data.tag;

          // Update local state immediately
          setCurrentAvailableTags((prev) => [newTag, ...prev]);

          // Notify parent to update global state
          if (onGlobalTagCreated) {
            onGlobalTagCreated(newTag);
          }

          // Automatically select the new tag if limit not reached
          if (selectedTags.length < MAX_TAGS_LIMIT) {
            onTagsChange([...selectedTags, { id: newTag.id, name: newTag.name }]);
          }

          setSearchTerm("");
        } else {
          toast.error(result.error || "Failed to create tag");
        }
      } catch (_e) {
        toast.error("Failed to create tag");
      }
    });
  };

  // Filter tags manually for Command
  const filteredTags = currentAvailableTags.filter((tag) =>
    tag.name.toLowerCase().includes(searchTerm.trim().toLowerCase()),
  );

  const exactMatchExists = currentAvailableTags.some(
    (tag) => tag.name.toLowerCase() === searchTerm.trim().toLowerCase(),
  );

  const showCreateOption = searchTerm.trim() !== "" && !exactMatchExists;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[500px]">
        <DialogHeader className="border-b px-4 py-4">
          <DialogTitle>Select Tags</DialogTitle>
          <DialogDescription>
            Add or select tags ({selectedTags.length}/{MAX_TAGS_LIMIT})
          </DialogDescription>
        </DialogHeader>

        <Command shouldFilter={false} className="flex grow flex-col overflow-hidden">
          <CommandInput
            placeholder="Search or create a tag..."
            value={searchTerm}
            onValueChange={setSearchTerm}
            className="border-none focus:ring-0"
          />
          <CommandList className="max-h-[400px] overflow-y-auto">
            {isLoadingInitialTags ? (
              <div className="text-muted-foreground flex items-center justify-center py-6 text-center text-sm">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : (
              <>
                {filteredTags.length === 0 && !showCreateOption && (
                  <CommandEmpty className="text-muted-foreground py-6 text-center text-sm">
                    No tags found.
                  </CommandEmpty>
                )}

                {showCreateOption && (
                  <CommandGroup>
                    <CommandItem onSelect={handleCreateTag} className="cursor-pointer">
                      <Plus className="mr-2 h-4 w-4" />
                      Create "{searchTerm}"
                      {isPending && <Loader2 className="ml-2 h-3 w-3 animate-spin" />}
                    </CommandItem>
                  </CommandGroup>
                )}

                {filteredTags.length > 0 && (
                  <CommandGroup heading="Available Tags">
                    {filteredTags.map((tag) => {
                      const isSelected = selectedTags.some((t) => t.id === tag.id);
                      return (
                        <CommandItem
                          key={tag.id}
                          onSelect={() => handleSelectTag(tag)}
                          className="cursor-pointer"
                        >
                          <div className="flex flex-1 items-center">{tag.name}</div>
                          {isSelected && <Check className="text-primary h-4 w-4" />}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>

        <div className="bg-muted/20 flex max-h-[150px] min-h-[50px] flex-wrap items-center gap-2 overflow-y-auto border-t p-3 px-4">
          {selectedTags.length === 0 ? (
            <span className="text-muted-foreground text-xs">No tags selected</span>
          ) : (
            selectedTags.map((tag) => (
              <Badge key={tag.id} variant="secondary" className="flex items-center pr-1">
                {tag.name}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    onTagsChange(selectedTags.filter((t) => t.id !== tag.id));
                  }}
                  className="hover:bg-destructive/20 focus:ring-ring ml-1 rounded-full p-0.5 transition-colors focus:ring-2 focus:ring-offset-1 focus:outline-none"
                >
                  <X className="h-3 w-3" />
                  <span className="sr-only">Remove {tag.name}</span>
                </button>
              </Badge>
            ))
          )}
        </div>

        <DialogFooter className="border-t p-4">
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
