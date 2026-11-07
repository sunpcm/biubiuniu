/**
 * [INPUT]: Depends on @/actions/feedback/user for getMyFeedbackDetail/addUserReply,
 *          @/constants/feedback for FEEDBACK_STATUS_COLORS/FEEDBACK_TYPE_ICONS/FEEDBACK_LIMITS,
 *          @/components/DynamicIcon for icon rendering,
 *          @tanstack/react-query for useQuery/useMutation/useQueryClient,
 *          @/components/ui for Sheet/Badge/Textarea/Button/ScrollArea/Skeleton
 * [OUTPUT]: Exports FeedbackDetailSheet component
 * [POS]: Side-panel detail view for a single feedback with reply thread,
 *        opened from FeedbackList card click
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import {
  addUserReply,
  getMyFeedbackDetail,
  type AddUserReplyResult,
  type GetMyFeedbackDetailResult,
} from "@/actions/feedback/user";
import { DynamicIcon } from "@/components/DynamicIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  FEEDBACK_LIMITS,
  FEEDBACK_STATUS_COLORS,
  FEEDBACK_TYPE_ICONS,
} from "@/constants/feedback";
import type { FeedbackReplyRow } from "@/lib/db/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { MessageSquare, RefreshCw, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";

dayjs.extend(relativeTime);

// ============================================================
// Props
// ============================================================

interface FeedbackDetailSheetProps {
  feedbackId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ============================================================
// Component
// ============================================================

export function FeedbackDetailSheet({
  feedbackId,
  open,
  onOpenChange,
}: FeedbackDetailSheetProps) {
  const t = useTranslations("Feedback");
  const queryClient = useQueryClient();
  const [replyContent, setReplyContent] = useState("");

  // ----------------------------------------------------------
  // Fetch detail
  // ----------------------------------------------------------

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["my-feedback-detail", feedbackId],
    queryFn: async () => {
      const result: GetMyFeedbackDetailResult =
        await getMyFeedbackDetail(feedbackId);
      if (!result.success) {
        toast.error(result.error);
        return null;
      }
      return result.data ?? null;
    },
    enabled: open,
  });

  const fb = data?.feedback ?? null;
  const replies = data?.replies ?? [];

  // ----------------------------------------------------------
  // Reply mutation
  // ----------------------------------------------------------

  const replyMutation = useMutation({
    mutationFn: async (content: string) => {
      const result: AddUserReplyResult = await addUserReply({
        feedbackId,
        content,
      });
      if (!result.success) throw new Error(result.error);
      return result.data!;
    },
    onSuccess: () => {
      setReplyContent("");
      queryClient.invalidateQueries({
        queryKey: ["my-feedback-detail", feedbackId],
      });
      queryClient.invalidateQueries({ queryKey: ["my-feedbacks"] });
    },
    onError: (err: Error) => {
      toast.error(t("toast.replyError"), { description: err.message });
    },
  });

  const handleSubmitReply = useCallback(() => {
    const trimmed = replyContent.trim();
    if (!trimmed) return;
    replyMutation.mutate(trimmed);
  }, [replyContent, replyMutation]);

  // ----------------------------------------------------------
  // Derived
  // ----------------------------------------------------------

  const iconName = fb ? (FEEDBACK_TYPE_ICONS[fb.type] ?? "Wrench") : "Wrench";
  const statusColor = fb ? (FEEDBACK_STATUS_COLORS[fb.status] ?? "") : "";
  const charCount = replyContent.length;
  const charOverLimit = charCount > FEEDBACK_LIMITS.REPLY_MAX;

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col sm:max-w-lg">
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
                className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
          <SheetDescription className="sr-only">
            {t("detail.title")}
          </SheetDescription>
        </SheetHeader>

        {isLoading || !fb ? (
          <DetailSkeleton />
        ) : (
          <div className="flex flex-1 min-h-0 flex-col gap-3 px-4 pb-6">
            <ScrollArea className="flex-1 min-h-0">
              <div className="pr-3">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="bg-muted flex size-8 items-center justify-center rounded-lg">
                      <DynamicIcon
                        name={iconName}
                        className="text-muted-foreground size-4"
                      />
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {t(`type.${fb.type}`)}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className={`text-xs ${statusColor}`}
                    >
                      {t(`status.${fb.status}`)}
                    </Badge>
                    <span className="text-muted-foreground ml-auto text-xs">
                      {dayjs(fb.createdAt).fromNow()}
                    </span>
                  </div>

                  <h2 className="text-base font-semibold">{fb.title}</h2>
                  <p className="text-muted-foreground text-sm whitespace-pre-wrap">
                    {fb.description}
                  </p>
                </div>

                <Separator />

                <div>
                  <h3 className="text-muted-foreground py-2 text-xs font-medium uppercase tracking-wider">
                    {t("detail.replies")} ({replies.length})
                  </h3>
                  {replies.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <MessageSquare className="text-muted-foreground/40 mb-2 size-8" />
                      <p className="text-muted-foreground text-sm">
                        {t("detail.noReplies")}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {replies.map((reply) => (
                        <ReplyBubble key={reply.id} reply={reply} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>

            <Separator />

            {/* Reply input */}
            <div className="shrink-0 space-y-2">
              <Textarea
                placeholder={t("detail.replyPlaceholder")}
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                rows={3}
                className="resize-none"
                disabled={replyMutation.isPending}
              />
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs ${
                    charOverLimit ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {charCount}/{FEEDBACK_LIMITS.REPLY_MAX}
                </span>
                <Button
                  size="sm"
                  disabled={
                    !replyContent.trim() ||
                    charOverLimit ||
                    replyMutation.isPending
                  }
                  onClick={handleSubmitReply}
                >
                  {replyMutation.isPending ? (
                    t("button.replying")
                  ) : (
                    <>
                      <Send className="mr-1.5 size-3.5" />
                      {t("button.reply")}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ============================================================
// ReplyBubble — Single reply item
// ============================================================

function ReplyBubble({ reply }: { reply: FeedbackReplyRow }) {
  const t = useTranslations("Feedback");
  const timeAgo = dayjs(reply.createdAt).fromNow();

  return (
    <div
      className={`rounded-lg p-3 ${
        reply.isAdmin ? "bg-primary/5 border-primary/10 border" : "bg-muted/50"
      }`}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium">
          {reply.isAdmin
            ? t("detail.adminReply", { time: timeAgo })
            : t("detail.userReply", {
                name: reply.authorName || reply.authorEmail,
                time: timeAgo,
              })}
        </span>
      </div>
      <p className="text-sm whitespace-pre-wrap">{reply.content}</p>
    </div>
  );
}

// ============================================================
// Loading skeleton
// ============================================================

function DetailSkeleton() {
  return (
    <div className="space-y-4 p-6 w-full">
      <div className="flex items-center gap-2">
        <Skeleton className="size-8 rounded-lg" />
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-20 w-full" />
      <div className="space-y-3 pt-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    </div>
  );
}
