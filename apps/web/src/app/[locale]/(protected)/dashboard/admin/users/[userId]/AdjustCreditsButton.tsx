/**
 * [INPUT]: Depends on ../AdjustCreditsDialog's credit-adjustment dialog,
 *          next-intl's useTranslations (Users.detail.balance.adjust),
 *          next/navigation's useRouter, @/components/ui/button
 * [OUTPUT]: exports the AdjustCreditsButton component (the button that opens the
 *           credit-adjustment dialog)
 * [POS]: The client interaction bridge of admin/users/[userId] — the only client
 *        island inside the server-rendered balance card; on a successful
 *        adjustment it calls router.refresh() so the server-rendered balance
 *        catches up (cancelling the dialog refreshes nothing)
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { Button } from "@/components/ui/button";
import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdjustCreditsDialog } from "../AdjustCreditsDialog";

export function AdjustCreditsButton({
  userId,
  userEmail,
}: {
  userId: string;
  userEmail: string;
}) {
  const t = useTranslations("Users");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <SlidersHorizontal className="size-4" />
        {t("detail.balance.adjust")}
      </Button>
      <AdjustCreditsDialog
        open={open}
        onOpenChange={setOpen}
        // Only a real adjustment refreshes the server-rendered balance card;
        // cancelling out of the dialog changed nothing worth re-fetching
        onAdjusted={() => router.refresh()}
        userId={userId}
        userEmail={userEmail}
      />
    </>
  );
}
