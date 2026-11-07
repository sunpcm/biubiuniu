/**
 * [INPUT]: Depends on refundOrder/AdminOrderItem from @/actions/orders/admin,
 *          formatCents from @/lib/format, useTranslations/useLocale from next-intl,
 *          Dialog/RadioGroup/Input/Label/Button from @/components/ui
 * [OUTPUT]: Exports the RefundDialog component (full/partial refund confirmation dialog)
 * [POS]: The refund interaction layer of admin/orders, held by DataTable and opened per row;
 *        local ledger changes settle asynchronously through each provider's refund webhook,
 *        this file only initiates the refund;
 *        Creem's refund API supports full refunds only — the dialog hides partial refunds
 *        and shows a hint instead
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { AdminOrderItem, refundOrder } from "@/actions/orders/admin";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatCents } from "@/lib/format";
import { Info } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type RefundMode = "full" | "partial";

interface RefundDialogProps {
  order: AdminOrderItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the provider accepts the refund — refresh the table */
  onSuccess: () => void;
}

export function RefundDialog({
  order,
  open,
  onOpenChange,
  onSuccess,
}: RefundDialogProps) {
  const t = useTranslations("Orders.refundDialog");
  const tToast = useTranslations("Orders.toast");
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();

  const [mode, setMode] = useState<RefundMode>("full");
  const [amountInput, setAmountInput] = useState("");

  if (!order) return null;

  const refundableCents = order.amountTotal - order.amountRefunded;
  // Creem's refund API only refunds the whole remaining amount (no amount
  // parameter) — partial refunds must be initiated in the Creem dashboard, and
  // locally they always sync through the refund.created webhook
  const isCreem = order.provider === "creem";

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setMode("full");
      setAmountInput("");
    }
    onOpenChange(isOpen);
  };

  const handleConfirm = () => {
    let amountCents: number | undefined;

    if (mode === "partial") {
      const major = Number.parseFloat(amountInput);
      if (!Number.isFinite(major) || major <= 0) {
        toast.error(t("invalidAmount"));
        return;
      }
      amountCents = Math.round(major * 100);
      if (amountCents > refundableCents) {
        toast.error(
          t("exceedsRefundable", {
            max: formatCents(refundableCents, order.currency, locale),
          })
        );
        return;
      }
    }

    startTransition(async () => {
      const res = await refundOrder({ orderId: order.id, amountCents });
      if (res.success) {
        // Local order state + credit clawback land asynchronously via the
        // provider's refund webhook — surface that to the operator.
        toast.success(tToast("refundInitiated"));
        handleOpenChange(false);
        onSuccess();
      } else {
        // Surface the provider's rejection verbatim — it is actionable
        toast.error(tToast("refundFailed"), { description: res.error });
      }
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
          {/* ── Order money summary ── */}
          <div className="rounded-md border p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("orderAmount")}</span>
              <span className="tabular-nums">
                {formatCents(order.amountTotal, order.currency, locale)}
              </span>
            </div>
            {order.amountRefunded > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t("alreadyRefunded")}
                </span>
                <span className="tabular-nums text-red-600 dark:text-red-400">
                  {formatCents(order.amountRefunded, order.currency, locale)}
                </span>
              </div>
            )}
            <div className="flex justify-between font-medium">
              <span>{t("refundable")}</span>
              <span className="tabular-nums">
                {formatCents(refundableCents, order.currency, locale)}
              </span>
            </div>
          </div>

          {isCreem ? (
            /* ── Creem: full refund only — partial stays a dashboard operation ── */
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t("creemHint")}</span>
            </div>
          ) : (
            <>
              {/* ── Full vs partial ── */}
              <RadioGroup
                value={mode}
                onValueChange={(v) => setMode(v as RefundMode)}
                className="gap-3"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="full" id="refund-full" />
                  <Label htmlFor="refund-full" className="font-normal">
                    {t("fullRefund")}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="partial" id="refund-partial" />
                  <Label htmlFor="refund-partial" className="font-normal">
                    {t("partialRefund")}
                  </Label>
                </div>
              </RadioGroup>

              {mode === "partial" && (
                <div className="space-y-2">
                  <Label htmlFor="refund-amount">
                    {t("amountLabel", {
                      currency: order.currency.toUpperCase(),
                    })}
                  </Label>
                  <Input
                    id="refund-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder={t("amountPlaceholder")}
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                  />
                </div>
              )}
            </>
          )}
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
            variant="destructive"
            onClick={handleConfirm}
            disabled={isPending || (mode === "partial" && !amountInput)}
          >
            {isPending ? t("processing") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
