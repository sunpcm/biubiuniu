"use client";

import { createPricingGroupAction, deletePricingGroupAction } from "@/actions/prices/groups";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@niu/ui/alert-dialog";
import { Button } from "@niu/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@niu/ui/dialog";
import { Input } from "@niu/ui/input";
import { ScrollArea } from "@niu/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@niu/ui/tooltip";
import { pricingPlans as pricingPlansSchema } from "@/lib/db/schema";
import { SLUG_REGEX } from "@/lib/pricing/slug";
import { usePricingGroupStore } from "@/stores/pricingGroupStore";
import { PricingPlanGroup } from "@/types/pricing";
import { FolderOpen, Loader2, PlusCircle, Trash2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

type PricingPlan = typeof pricingPlansSchema.$inferSelect;

interface GroupManagementDialogProps {
  plans: PricingPlan[];
}

export function GroupManagementDialog({ plans }: GroupManagementDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [newSlug, setNewSlug] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const [groupToDelete, setGroupToDelete] = useState<PricingPlanGroup | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const { groups, isLoading, fetchGroups, addGroup, removeGroup } = usePricingGroupStore();

  // Initial load when mounting or opening
  useEffect(() => {
    if (isOpen) {
      setNewSlug("");
      // Re-fetch in background to ensure freshness
      fetchGroups(true);
    } else {
      // Ensure data is loaded at least once if not already
      fetchGroups();
    }
  }, [isOpen, fetchGroups]);

  // Get the count of plans for a group
  const getPlanCount = (groupSlug: string) => {
    return plans.filter((plan) => plan.groupSlug === groupSlug).length;
  };

  const handleCreateGroup = async () => {
    const trimmedSlug = newSlug.trim().toLowerCase();

    if (!trimmedSlug) {
      toast.info("Please enter a group slug.");
      return;
    }

    if (!SLUG_REGEX.test(trimmedSlug)) {
      toast.error("Slug can only contain lowercase letters, numbers, and hyphens.");
      return;
    }

    if (groups.some((g) => g.slug === trimmedSlug)) {
      toast.info(`Group "${trimmedSlug}" already exists.`);
      return;
    }

    setIsCreating(true);
    try {
      const result = await createPricingGroupAction({ slug: trimmedSlug });
      if (result.success) {
        if (result.data) {
          addGroup(result.data);
          setNewSlug("");
        } else {
          toast.error("Failed to create group: No data returned.");
        }
      } else {
        toast.error("Failed to create group.", { description: result.error });
      }
    } catch (error) {
      toast.error("Failed to create group.");
      console.error("Failed to create group:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const confirmDelete = (group: PricingPlanGroup) => {
    setGroupToDelete(group);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteGroup = () => {
    if (!groupToDelete) return;

    startTransition(async () => {
      const result = await deletePricingGroupAction({
        slug: groupToDelete.slug,
      });
      if (result.success) {
        removeGroup(groupToDelete.slug);
        setIsDeleteDialogOpen(false);
        setGroupToDelete(null);
      } else {
        toast.error(`Failed to delete group "${groupToDelete.slug}".`, {
          description: result.error,
        });
      }
    });
  };

  // Sort groups for display, with "default" first
  const sortedGroups = [...groups].sort((a, b) => {
    if (a.slug === "default") return -1;
    if (b.slug === "default") return 1;
    return a.slug.localeCompare(b.slug);
  });

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">
            <FolderOpen className="mr-2 h-4 w-4" /> Manage Groups
          </Button>
        </DialogTrigger>
        <DialogContent className="flex h-[600px] max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>Manage Groups</DialogTitle>
            <DialogDescription>
              Create or delete groups for organizing pricing plans.
            </DialogDescription>
          </DialogHeader>

          <div className="bg-muted/20 border-b p-4">
            <div className="flex items-center gap-2">
              <Input
                placeholder="new-group-slug"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value.toLowerCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isCreating) {
                    handleCreateGroup();
                  }
                }}
                disabled={isCreating || isPending}
              />
              <Button
                type="button"
                size="icon"
                onClick={handleCreateGroup}
                disabled={isCreating || !newSlug.trim() || isPending}
              >
                {isCreating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlusCircle className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-muted-foreground mt-2 text-xs">
              Only lowercase letters, numbers, and hyphens are allowed.
            </p>
          </div>

          <ScrollArea className="min-h-0 flex-1 overflow-hidden">
            {isLoading && groups.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2">
                <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
                <span className="text-muted-foreground text-sm">Loading groups...</span>
              </div>
            ) : sortedGroups.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center p-4 text-center">
                <FolderOpen className="text-muted-foreground/30 mb-2 h-10 w-10" />
                <p className="text-muted-foreground text-sm font-medium">No groups found</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Create your first group using the form above.
                </p>
              </div>
            ) : (
              <div className="p-4">
                <ul className="space-y-2">
                  {sortedGroups.map((group) => {
                    const planCount = getPlanCount(group.slug);
                    const isDefault = group.slug === "default";
                    const canDelete = !isDefault && planCount === 0;

                    return (
                      <li
                        key={group.slug}
                        className="hover:bg-muted/50 group bg-card flex items-center justify-between rounded-md border p-3 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="bg-primary/10 text-primary flex h-8 w-8 items-center justify-center rounded-full">
                            <FolderOpen className="h-4 w-4" />
                          </div>
                          <div className="flex flex-col">
                            <span className="font-mono text-sm font-medium">{group.slug}</span>
                            <span className="text-muted-foreground text-xs">
                              {planCount} plan{planCount !== 1 ? "s" : ""}
                            </span>
                          </div>
                        </div>
                        <div className="flex space-x-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                          {canDelete ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => confirmDelete(group)}
                              title="Delete group"
                              disabled={isPending}
                              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 w-8"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      disabled
                                      className="text-muted-foreground/40 h-8 w-8 cursor-not-allowed"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {isDefault
                                    ? "Cannot delete default group"
                                    : `Cannot delete: ${planCount} plan${planCount !== 1 ? "s" : ""} in this group`}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </ScrollArea>

          <DialogFooter className="bg-background border-t p-4">
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          if (!isPending) setIsDeleteDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the group "
              <span className="text-foreground font-mono font-semibold">{groupToDelete?.slug}</span>
              ". This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDeleteGroup();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
