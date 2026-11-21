/**
 * [INPUT]: Depends on @/actions/feedback/admin for getFeedbackDetail/updateFeedbackStatus/updateFeedbackPriority,
 *          @/constants/feedback for color/icon constants,
 *          @/components/DynamicIcon for type icons,
 *          @/components/ui for Sheet/Avatar/Badge/Select/ScrollArea,
 *          @tanstack/react-query for useQuery,
 *          ./ReplyForm for reply composition
 * [OUTPUT]: Exports FeedbackDetailSheet component
 * [POS]: Slide-over detail panel for a single feedback item with reply thread, opened from DataTable
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import {
  getFeedbackDetail,
  updateFeedbackPriority,
  updateFeedbackStatus,
} from "@/actions/feedback/admin";
import { DynamicIcon } from "@/components/DynamicIcon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  FEEDBACK_PRIORITIES,
  FEEDBACK_PRIORITY_COLORS,
  FEEDBACK_STATUS_COLORS,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPE_ICONS,
} from "@/constants/feedback";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { ReplyForm } from "./ReplyForm";

dayjs.extend(relativeTime);

// ──────────────────────────────────────────────
//  Props
// ──────────────────────────────────────────────

interface FeedbackDetailSheetProps {
  feedbackId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate?: () => void;
}

// ──────────────────────────────────────────────
//  Component
// ──────────────────────────────────────────────

export function FeedbackDetailSheet({
  feedbackId,
  open,
  onOpenChange,
  onUpdate,
}: FeedbackDetailSheetProps) {
  const t = useTranslations("Feedback");
  const queryClient = useQueryClient();

  const queryKey = ["admin-feedback-detail", feedbackId];

  const {
    data: detail,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!feedbackId) return null;
      const result = await getFeedbackDetail(feedbackId);
      if (!result.success) {
        toast.error("Failed to load feedback detail", {
          description: result.error,
        });
        return null;
      }
      return result.data ?? null;
    },
    enabled: !!feedbackId && open,
  });

  const handleReplySuccess = () => {
    refetch();
    onUpdate?.();
  };

  const invalidateAndRefetch = () => {
    queryClient.invalidateQueries({ queryKey });
    onUpdate?.();
  };

  const fb = detail?.feedback;
  const replies = detail?.replies ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader className="shrink-0">
          <div className="flex items-center gap-2">
            <SheetTitle>{t("detail.title")}</SheetTitle>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => refetch()}
              disabled={isFetching}
              title="Refresh"
            >
              <RefreshCw
                className={cn("h-4 w-4", isFetching && "animate-spin")}
              />
            </Button>
          </div>
          <SheetDescription className="sr-only">
            {t("detail.title")}
          </SheetDescription>
        </SheetHeader>

        {isLoading || !fb ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 flex-col gap-3 px-4 pb-6">
            <ScrollArea className="flex-1 min-h-0">
              <div className="pr-3">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage
                        src={fb.user.image || undefined}
                        alt={fb.user.name || fb.user.email}
                      />
                      <AvatarFallback>
                        {(
                          fb.user.name?.[0] ||
                          fb.user.email[0] ||
                          "?"
                        ).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">
                          {fb.user.name || "Unknown"}
                        </span>
                        {fb.user.banned && (
                          <Badge
                            variant="destructive"
                            className="text-[10px] px-1.5 py-0"
                          >
                            Banned
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground truncate">
                        {fb.user.email}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className="font-semibold text-base leading-tight">
                      {fb.title}
                    </h3>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className="gap-1 text-xs capitalize"
                      >
                        <DynamicIcon
                          name={FEEDBACK_TYPE_ICONS[fb.type] || "Wrench"}
                          className="h-3 w-3"
                        />
                        {fb.type.replace(/_/g, " ")}
                      </Badge>

                      <InlineSelect
                        value={fb.priority}
                        options={[...FEEDBACK_PRIORITIES]}
                        colorMap={FEEDBACK_PRIORITY_COLORS}
                        onUpdate={async (newVal) => {
                          const result = await updateFeedbackPriority({
                            feedbackId: fb.id,
                            priority: newVal,
                          });
                          if (!result.success) throw new Error(result.error);
                        }}
                        label="Priority"
                        onSuccess={invalidateAndRefetch}
                      />

                      <InlineSelect
                        value={fb.status}
                        options={[...FEEDBACK_STATUSES]}
                        colorMap={FEEDBACK_STATUS_COLORS}
                        onUpdate={async (newVal) => {
                          const result = await updateFeedbackStatus({
                            feedbackId: fb.id,
                            status: newVal,
                          });
                          if (!result.success) throw new Error(result.error);
                        }}
                        label="Status"
                        formatLabel={(v) => v.replace(/_/g, " ")}
                        onSuccess={invalidateAndRefetch}
                      />
                    </div>

                    <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                      {fb.description}
                    </p>

                    <div className="text-xs text-muted-foreground">
                      {t("detail.submitted", {
                        time: dayjs(fb.createdAt).fromNow(),
                      })}
                    </div>
                  </div>
                </div>

                <Separator />

                <div>
                  <h4 className="text-muted-foreground py-2 text-xs font-medium uppercase tracking-wider">
                    {t("detail.replies")} ({replies.length})
                  </h4>
                  {replies.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">
                      {t("detail.noReplies")}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {replies.map((reply) => {
                        const timeAgo = dayjs(reply.createdAt).fromNow();
                        return (
                          <div
                            key={reply.id}
                            className={`rounded-lg p-3 ${
                              reply.isAdmin
                                ? "bg-primary/5 border-primary/10 border"
                                : "bg-muted/50"
                            }`}
                          >
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-xs font-medium">
                                {reply.isAdmin
                                  ? t("detail.adminReply", { time: timeAgo })
                                  : t("detail.userReply", {
                                      name:
                                        reply.authorName || reply.authorEmail,
                                      time: timeAgo,
                                    })}
                              </span>
                            </div>
                            <p className="text-sm whitespace-pre-wrap leading-relaxed">
                              {reply.content}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>

            <Separator />

            {/* ── Reply form (pinned bottom) ── */}
            <div className="shrink-0">
              <ReplyForm feedbackId={fb.id} onSuccess={handleReplySuccess} />
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ──────────────────────────────────────────────
//  InlineSelect — reusable mini select with color badge
// ──────────────────────────────────────────────

function InlineSelect({
  value,
  options,
  colorMap,
  onUpdate,
  onSuccess,
  label,
  formatLabel = (v) => v,
}: {
  value: string;
  options: string[];
  colorMap: Record<string, string>;
  onUpdate: (newVal: string) => Promise<void>;
  onSuccess: () => void;
  label: string;
  formatLabel?: (v: string) => string;
}) {
  const [isPending, startTransition] = useTransition();

  const handleChange = (newVal: string) => {
    if (newVal === value) return;
    startTransition(async () => {
      try {
        await onUpdate(newVal);
        onSuccess();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        toast.error(`Failed to update ${label.toLowerCase()}`, {
          description: message,
        });
      }
    });
  };

  const colorClass = colorMap[value] || "";

  return (
    <Select value={value} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger
        className={`h-6 w-auto min-w-[90px] text-xs border-0 px-2 ${colorClass} ${
          isPending ? "opacity-50" : ""
        }`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt} value={opt} className="text-xs capitalize">
            {formatLabel(opt)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
