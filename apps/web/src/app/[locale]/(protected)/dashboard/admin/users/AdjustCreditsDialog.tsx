/**
 * [INPUT]: Depends on @/actions/credits/admin for addUserCredits/
 *          setUserCredits/deductUserCredits/getUserCreditsForAdmin,
 *          next-intl for useTranslations, @/components/ui for
 *          Dialog/Input/Label/Select/Textarea/Button/Skeleton
 * [OUTPUT]: exports the AdjustCreditsDialog component (admins add, set or
 *           deduct a single credit bucket; on success it calls onAdjusted and
 *           the caller decides which channel to refresh)
 * [POS]: The credit-adjustment interaction layer of admin/users, opened per
 *        row by the ActionsCell in Columns (callback refreshes the React
 *        Query table cache) and by [userId]/AdjustCreditsButton (callback
 *        refreshes the RSC cards); loads the balances on open and writes the
 *        selected bucket through the fresh-admin server actions
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import {
  addUserCredits,
  deductUserCredits,
  getUserCreditsForAdmin,
  setUserCredits,
} from "@/actions/credits/admin";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

interface CreditBalances {
  subscriptionCredits: number;
  purchasedCredits: number;
  totalCredits: number;
}

type CreditBucket = "subscription" | "purchased";
type CreditOperation = "add" | "set" | "deduct";

interface AdjustCreditsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userEmail: string;
  /** Fired after a successful adjustment: the new balance is the server's call and cannot be guessed, so the caller refetches */
  onAdjusted?: () => void;
}

export function AdjustCreditsDialog({
  open,
  onOpenChange,
  userId,
  userEmail,
  onAdjusted,
}: AdjustCreditsDialogProps) {
  const t = useTranslations("Users.adjustCredits");
  const [isPending, startTransition] = useTransition();

  const [balances, setBalances] = useState<CreditBalances | null>(null);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const [bucket, setBucket] = useState<CreditBucket>("subscription");
  const [operation, setOperation] = useState<CreditOperation>("add");
  const [amountInput, setAmountInput] = useState("");
  const [reason, setReason] = useState("");

  // ── load balances whenever the dialog opens ──
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setIsLoadingBalances(true);
    setBalances(null);

    getUserCreditsForAdmin({ userId })
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.data) {
          setBalances(res.data);
        } else {
          toast.error(t("loadFailed"), {
            description: res.success ? undefined : res.error,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBalances(false);
      });

    return () => {
      cancelled = true;
    };
    // `t` is deliberately absent: next-intl rebuilds it whenever the layout
    // re-renders, which would re-enter this effect on every RSC pass. Locale
    // changes remount the tree, so the closure can never go stale.
  }, [open, userId]);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setBucket("subscription");
      setOperation("add");
      setAmountInput("");
      setReason("");
    }
    onOpenChange(isOpen);
  };

  const handleConfirm = () => {
    const amount = Number(amountInput);
    if (!Number.isSafeInteger(amount) || amount < 0) {
      toast.error(t("invalidAmount"));
      return;
    }
    if (!reason.trim()) {
      toast.error(t("reasonRequired"));
      return;
    }

    startTransition(async () => {
      const params = { userId, bucket, amount, reason: reason.trim() };
      const res =
        operation === "add"
          ? await addUserCredits(params)
          : operation === "set"
            ? await setUserCredits(params)
            : await deductUserCredits(params);
      if (res.success && res.data) {
        toast.success(t("success", { total: res.data.totalCredits }));
        handleOpenChange(false);
        onAdjusted?.();
      } else {
        toast.error(t("failed"), {
          description: res.success ? undefined : res.error,
        });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { email: userEmail })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ── current balances ── */}
          <div className="rounded-md border p-3 text-sm space-y-1">
            <p className="font-medium">{t("currentBalance")}</p>
            {isLoadingBalances || !balances ? (
              <div className="space-y-1.5 pt-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-40" />
              </div>
            ) : (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t("subscription")}
                  </span>
                  <span className="tabular-nums">
                    {balances.subscriptionCredits}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t("purchased")}
                  </span>
                  <span className="tabular-nums">
                    {balances.purchasedCredits}
                  </span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>{t("total")}</span>
                  <span className="tabular-nums">{balances.totalCredits}</span>
                </div>
              </>
            )}
          </div>

          {/* ── bucket + operation ── */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t("bucketLabel")}</Label>
              <Select
                value={bucket}
                onValueChange={(value) => setBucket(value as CreditBucket)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("bucketLabel")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="subscription">{t("subscription")}</SelectItem>
                  <SelectItem value="purchased">{t("purchased")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("operationLabel")}</Label>
              <Select
                value={operation}
                onValueChange={(value) => setOperation(value as CreditOperation)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("operationLabel")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="add">{t("operation.add")}</SelectItem>
                  <SelectItem value="set">{t("operation.set")}</SelectItem>
                  <SelectItem value="deduct">{t("operation.deduct")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── amount ── */}
          <div className="space-y-2">
            <Label htmlFor={`credits-amount-${userId}`}>{t("amountLabel")}</Label>
            <Input
              id={`credits-amount-${userId}`}
              type="number"
              min="0"
              step="1"
              placeholder={t("amountPlaceholder")}
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("amountHint")}</p>
          </div>

          {/* ── reason ── */}
          <div className="space-y-2">
            <Label htmlFor={`credits-reason-${userId}`}>
              {t("reasonLabel")}
            </Label>
            <Textarea
              id={`credits-reason-${userId}`}
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
            disabled={isPending || !amountInput || !reason.trim()}
          >
            {isPending ? t("processing") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
