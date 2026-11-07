/**
 * [INPUT]: Depends on next-intl's useTranslations (Users.detail.copied),
 *          sonner's toast, @/lib/utils' cn
 * [OUTPUT]: exports the CopyText component (click to copy text to the clipboard)
 * [POS]: The copy-interaction atom of admin/users/[userId], used by page.tsx to
 *        render email and stripeCustomerId as copyable text
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

export function CopyText({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const t = useTranslations("Users");

  return (
    <span
      className={cn("cursor-pointer hover:underline", className)}
      onClick={() => {
        navigator.clipboard.writeText(value);
        toast.success(t("detail.copied"));
      }}
    >
      {value}
    </span>
  );
}
