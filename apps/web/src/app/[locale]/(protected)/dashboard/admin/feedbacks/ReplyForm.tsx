/**
 * [INPUT]: Depends on @/actions/feedback/admin for addAdminReply,
 *          @/constants/feedback for FEEDBACK_LIMITS,
 *          @/components/ui for Button/Textarea
 * [OUTPUT]: Exports ReplyForm component
 * [POS]: Reply composition form used inside FeedbackDetailSheet
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { addAdminReply } from "@/actions/feedback/admin";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FEEDBACK_LIMITS } from "@/constants/feedback";
import { Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface ReplyFormProps {
  feedbackId: string;
  onSuccess: () => void;
}

export function ReplyForm({ feedbackId, onSuccess }: ReplyFormProps) {
  const t = useTranslations("Feedback");
  const [content, setContent] = useState("");
  const [isPending, startTransition] = useTransition();

  const charCount = content.length;
  const isOverLimit = charCount > FEEDBACK_LIMITS.REPLY_MAX;
  const isEmpty = content.trim().length === 0;

  const handleSubmit = () => {
    if (isEmpty || isOverLimit) return;

    startTransition(async () => {
      const result = await addAdminReply({
        feedbackId,
        content: content.trim(),
      });

      if (result.success) {
        setContent("");
        onSuccess();
      } else {
        toast.error("Failed to send reply", {
          description: result.error,
        });
      }
    });
  };

  return (
    <div className="space-y-2">
      <Textarea
        placeholder={t("detail.replyPlaceholder")}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        disabled={isPending}
        rows={3}
        className="resize-none"
      />
      <div className="flex items-center justify-between">
        <span
          className={`text-xs ${
            isOverLimit ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {charCount}/{FEEDBACK_LIMITS.REPLY_MAX}
        </span>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={isPending || isEmpty || isOverLimit}
        >
          {isPending ? (
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
  );
}
