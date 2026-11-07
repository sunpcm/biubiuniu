/**
 * [INPUT]: Depends on @/hooks/use-mobile for useIsMobile,
 *          @/components/ui/dialog and @/components/ui/sheet for responsive wrapper,
 *          next-intl for translations
 * [OUTPUT]: Exports FeedbackDialog component
 * [POS]: Responsive feedback dialog — Dialog on desktop, Sheet (bottom) on mobile.
 *        Rendered in root layout alongside FeedbackFab
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { useTranslations } from "next-intl";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

import { FeedbackForm } from "./FeedbackForm";
import { useFeedback } from "./FeedbackProvider";

// ============================================================
// Component
// ============================================================

export function FeedbackDialog() {
  const { isOpen, closeDialog } = useFeedback();
  const isMobile = useIsMobile();
  const t = useTranslations("Feedback");

  if (!isMobile) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t("form.title")}</DialogTitle>
            <DialogDescription>{t("form.description")}</DialogDescription>
          </DialogHeader>
          <FeedbackForm />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && closeDialog()}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("form.title")}</SheetTitle>
          <SheetDescription>{t("form.description")}</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <FeedbackForm />
        </div>
      </SheetContent>
    </Sheet>
  );
}
