/**
 * [INPUT]: Depends on @/actions/feedback/user for createFeedback,
 *          @/constants/feedback for FEEDBACK_LIMITS/FEEDBACK_TYPES,
 *          @/lib/auth/auth-client for session, sonner for toast,
 *          shadcn/ui for form controls
 * [OUTPUT]: Exports FeedbackForm component
 * [POS]: Feedback submission form with type select, title, description,
 *        character counters, and draft persistence for unauthenticated users.
 *        Rendered inside FeedbackDialog
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { useEffect, useState } from "react";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createFeedback } from "@/actions/feedback/user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FEEDBACK_LIMITS, FEEDBACK_TYPES } from "@/constants/feedback";
import { authClient } from "@/lib/auth/auth-client";

import { useFeedback } from "./FeedbackProvider";

// ============================================================
// Component
// ============================================================

export function FeedbackForm() {
  const { data: session } = authClient.useSession();
  const { isOpen, closeDialog, draft, saveDraft, clearDraft } = useFeedback();
  const t = useTranslations("Feedback");

  const [type, setType] = useState(draft?.type || "");
  const [title, setTitle] = useState(draft?.title || "");
  const [description, setDescription] = useState(draft?.description || "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form to the latest draft whenever the dialog opens
  useEffect(() => {
    if (isOpen) {
      setType(draft?.type || "");
      setTitle(draft?.title || "");
      setDescription(draft?.description || "");
    }
  }, [isOpen, draft]);

  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();

  const isValid =
    type.length > 0 &&
    trimmedTitle.length >= FEEDBACK_LIMITS.TITLE_MIN &&
    trimmedTitle.length <= FEEDBACK_LIMITS.TITLE_MAX &&
    trimmedDescription.length >= FEEDBACK_LIMITS.DESCRIPTION_MIN &&
    trimmedDescription.length <= FEEDBACK_LIMITS.DESCRIPTION_MAX;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Unauthenticated — persist draft and prompt login
    if (!session?.user) {
      saveDraft({ type, title: trimmedTitle, description: trimmedDescription });
      toast.info(t("toast.loginRequired"));
      closeDialog();
      return;
    }

    if (!isValid) return;

    setIsSubmitting(true);
    try {
      const result = await createFeedback({
        type: type as (typeof FEEDBACK_TYPES)[number],
        title: trimmedTitle,
        description: trimmedDescription,
      });
      if (result.success) {
        toast.success(t("toast.submitSuccess"));
        clearDraft();
        closeDialog();
      } else {
        toast.error(result.error || t("toast.submitError"));
      }
    } catch {
      toast.error(t("toast.submitError"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Type select */}
      <div className="space-y-2">
        <Label>{t("form.type.label")}</Label>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger>
            <SelectValue placeholder={t("form.type.placeholder")} />
          </SelectTrigger>
          <SelectContent>
            {FEEDBACK_TYPES.map((ft) => (
              <SelectItem key={ft} value={ft}>
                {t(`form.type.${ft}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Title input */}
      <div className="space-y-2">
        <Label>{t("form.subject.label")}</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("form.subject.placeholder")}
          maxLength={FEEDBACK_LIMITS.TITLE_MAX}
        />
        <p
          className={`text-xs text-right ${
            title.length > 0 && title.length < FEEDBACK_LIMITS.TITLE_MIN
              ? "text-amber-500 dark:text-amber-400"
              : "text-muted-foreground"
          }`}
        >
          {title.length}/{FEEDBACK_LIMITS.TITLE_MAX}
          {title.length < FEEDBACK_LIMITS.TITLE_MIN && (
            <>
              {" · "}
              {t("form.subject.error", {
                min: FEEDBACK_LIMITS.TITLE_MIN,
                max: FEEDBACK_LIMITS.TITLE_MAX,
              })}
            </>
          )}
        </p>
      </div>

      {/* Description textarea */}
      <div className="space-y-2">
        <Label>{t("form.descriptionField.label")}</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("form.descriptionField.placeholder")}
          maxLength={FEEDBACK_LIMITS.DESCRIPTION_MAX}
          rows={5}
        />
        <p
          className={`text-xs text-right ${
            description.length > 0 &&
            description.length < FEEDBACK_LIMITS.DESCRIPTION_MIN
              ? "text-amber-500 dark:text-amber-400"
              : "text-muted-foreground"
          }`}
        >
          {description.length}/{FEEDBACK_LIMITS.DESCRIPTION_MAX}
          {description.length < FEEDBACK_LIMITS.DESCRIPTION_MIN && (
            <>
              {" · "}
              {t("form.descriptionField.error", {
                min: FEEDBACK_LIMITS.DESCRIPTION_MIN,
                max: FEEDBACK_LIMITS.DESCRIPTION_MAX,
              })}
            </>
          )}
        </p>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={closeDialog}>
          {t("button.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting || !isValid}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isSubmitting ? t("button.submitting") : t("button.submit")}
        </Button>
      </div>
    </form>
  );
}
