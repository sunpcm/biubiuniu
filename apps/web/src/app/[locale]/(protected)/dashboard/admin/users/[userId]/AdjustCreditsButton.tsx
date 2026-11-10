/**
 * [INPUT]: Depends on ../AdjustCreditsDialog's credit-adjustment dialog,
 *          next-intl's useTranslations (Users.detail.balance.adjust),
 *          next/navigation's useRouter, @tanstack/react-query's useQueryClient,
 *          @/components/ui/button
 * [OUTPUT]: exports the AdjustCreditsButton component (the button that opens the
 *           credit-adjustment dialog)
 * [POS]: The client interaction bridge of admin/users/[userId] — the only client
 *        island inside the server-rendered balance card; on a successful
 *        adjustment it invalidates this user's paged credit-ledger cache and
 *        calls router.refresh() so both the ledger and server-rendered balance
 *        catch up (cancelling the dialog refreshes nothing)
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdjustCreditsDialog } from "../AdjustCreditsDialog";

export function AdjustCreditsButton({ userId, userEmail }: { userId: string; userEmail: string }) {
  const t = useTranslations("Users");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const handleAdjusted = () => {
    // Mark every cached page stale; React Query refetches only the visible page.
    void queryClient.invalidateQueries({
      queryKey: ["admin-user-credit-tx", userId],
      exact: false,
      refetchType: "active",
    });
    router.refresh();
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <SlidersHorizontal className="size-4" />
        {t("detail.balance.adjust")}
      </Button>
      <AdjustCreditsDialog
        open={open}
        onOpenChange={setOpen}
        // The dialog fires this only after a successful adjustment.
        onAdjusted={handleAdjusted}
        userId={userId}
        userEmail={userEmail}
      />
    </>
  );
}
