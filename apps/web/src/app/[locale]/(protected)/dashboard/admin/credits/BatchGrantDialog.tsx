/**
 * [INPUT]: Depends on @/actions/credits/admin's grantCreditsToUsers,
 *          next-intl's useTranslations, sonner's toast,
 *          @/components/ui's Dialog/Textarea/Input/Label/Button
 * [OUTPUT]: exports the BatchGrantDialog component (batch credit grant by email)
 * [POS]: The batch-grant interaction layer of admin/credits, opened from the
 *        DataTable toolbar button; the whole grant runs in a single server-side
 *        transaction, and unmatched emails are echoed back as a warning
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { grantCreditsToUsers } from "@/actions/credits/admin";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

// Kept in sync with BATCH_GRANT_MAX_RECIPIENTS in actions/credits/admin.ts
const MAX_RECIPIENTS = 200;

/** Comma / newline / whitespace separated → trim → lowercase, deduped */
function parseEmails(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\s,]+/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

interface BatchGrantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the grant lands — refresh the table */
  onSuccess: () => void;
}

export function BatchGrantDialog({
  open,
  onOpenChange,
  onSuccess,
}: BatchGrantDialogProps) {
  const t = useTranslations("Credits.batchGrant");
  const [isPending, startTransition] = useTransition();

  const [emailsInput, setEmailsInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [reason, setReason] = useState("");

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setEmailsInput("");
      setAmountInput("");
      setReason("");
    }
    onOpenChange(isOpen);
  };

  const handleConfirm = () => {
    const emails = parseEmails(emailsInput);
    if (emails.length === 0) {
      toast.error(t("invalidEmails"));
      return;
    }
    if (emails.length > MAX_RECIPIENTS) {
      toast.error(t("tooManyEmails", { max: MAX_RECIPIENTS }));
      return;
    }

    const amount = Number(amountInput);
    if (!Number.isInteger(amount) || amount <= 0) {
      toast.error(t("invalidAmount"));
      return;
    }

    if (!reason.trim()) {
      toast.error(t("reasonRequired"));
      return;
    }

    startTransition(async () => {
      const res = await grantCreditsToUsers({
        emails,
        amount,
        reason: reason.trim(),
      });

      if (!res.success) {
        toast.error(t("failed"), { description: res.error });
        return;
      }

      const data = res.data;
      if (!data) {
        toast.error(t("failed"));
        return;
      }

      toast.success(t("success", { amount, count: data.granted.length }));
      if (data.notFoundEmails.length > 0) {
        toast.warning(
          t("notFound", { emails: data.notFoundEmails.join(", ") })
        );
      }
      handleOpenChange(false);
      onSuccess();
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ── Recipient emails ── */}
          <div className="space-y-2">
            <Label htmlFor="grant-emails">{t("emailsLabel")}</Label>
            <Textarea
              id="grant-emails"
              rows={5}
              placeholder={t("emailsPlaceholder")}
              value={emailsInput}
              onChange={(e) => setEmailsInput(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("emailsHint", { max: MAX_RECIPIENTS })}
            </p>
          </div>

          {/* ── Credits per recipient ── */}
          <div className="space-y-2">
            <Label htmlFor="grant-amount">{t("amountLabel")}</Label>
            <Input
              id="grant-amount"
              type="number"
              min="1"
              step="1"
              placeholder={t("amountPlaceholder")}
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
            />
          </div>

          {/* ── Reason (required, written to the ledger) ── */}
          <div className="space-y-2">
            <Label htmlFor="grant-reason">{t("reasonLabel")}</Label>
            <Textarea
              id="grant-reason"
              rows={2}
              placeholder={t("reasonPlaceholder")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            {t("cancel")}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              isPending || !emailsInput.trim() || !amountInput || !reason.trim()
            }
          >
            {isPending ? t("processing") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
