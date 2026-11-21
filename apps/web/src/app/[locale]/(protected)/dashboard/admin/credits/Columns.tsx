/**
 * [INPUT]: Depends on @/actions/credits/admin for AdminCreditTransactionItem,
 *          @/lib/db/schema for CreditTransactionType, @/i18n/routing for Link,
 *          @/components/ui for Badge/Button/DropdownMenu, @tanstack/react-table for ColumnDef
 * [OUTPUT]: exports columns (the credit ledger column definitions)
 * [POS]: The column definitions of admin/credits, consumed by DataTable; the row
 *        actions (copy user ID, jump to user) are self-contained and do not go
 *        through table meta callbacks
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { AdminCreditTransactionItem } from "@/actions/credits/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link as I18nLink } from "@/i18n/routing";
import { CreditTransactionType } from "@/lib/db/schema";
import { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import { MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

// ──────────────────────────────────────────────
//  Badge palettes — one map, no branching
// ──────────────────────────────────────────────

const TYPE_BADGE_CLASS: Record<CreditTransactionType, string> = {
  purchase:
    "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400",
  subscription_grant:
    "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400",
  subscription_cycle_expire:
    "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  usage: "border-transparent bg-secondary text-secondary-foreground",
  usage_refund:
    "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400",
  refund_revoke:
    "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  subscription_end_revoke:
    "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  admin_adjustment:
    "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  signup_bonus:
    "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

// ──────────────────────────────────────────────
//  Cell components — rendered via flexRender,
//  so next-intl hooks are safe here
// ──────────────────────────────────────────────

const HeaderText = ({ k }: { k: string }) => {
  const t = useTranslations("Credits");
  return <>{t(`columns.${k}`)}</>;
};

// The Credits namespace has no columns.actions — reuse actions.menuLabel as the header
const ActionsHeaderText = () => {
  const t = useTranslations("Credits");
  return <>{t("actions.menuLabel")}</>;
};

const TypeBadge = ({ type }: { type: CreditTransactionType }) => {
  const t = useTranslations("Credits");
  return (
    <Badge variant="outline" className={TYPE_BADGE_CLASS[type]}>
      {t(`type.${type}`)}
    </Badge>
  );
};

const BalanceAfterCell = ({ tx }: { tx: AdminCreditTransactionItem }) => {
  const t = useTranslations("Credits");
  const total = tx.subscriptionCreditsAfter + tx.purchasedCreditsAfter;
  return (
    <div className="flex flex-col">
      <span className="tabular-nums">{total}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {t("balanceBreakdown", {
          subscription: tx.subscriptionCreditsAfter,
          purchased: tx.purchasedCreditsAfter,
        })}
      </span>
    </div>
  );
};

const ActionsCell = ({ tx }: { tx: AdminCreditTransactionItem }) => {
  const t = useTranslations("Credits");

  // Deleted user's de-identified row: no user to copy or drill into.
  if (!tx.userId) return null;
  const userId = tx.userId;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-8 w-8 p-0">
          <span className="sr-only">{t("actions.menuLabel")}</span>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("actions.menuLabel")}</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => {
            navigator.clipboard.writeText(userId);
            toast.success(t("toast.copied"));
          }}
        >
          {t("actions.copyUserId")}
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <I18nLink href={`/dashboard/admin/users/${userId}`}>
            {t("actions.viewUser")}
          </I18nLink>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

// ──────────────────────────────────────────────
//  Column definitions
// ──────────────────────────────────────────────

export const columns: ColumnDef<AdminCreditTransactionItem>[] = [
  {
    accessorKey: "createdAt",
    header: () => <HeaderText k="createdAt" />,
    size: 170,
    minSize: 150,
    cell: ({ row }) => (
      <span className="whitespace-nowrap">
        {dayjs(row.original.createdAt).format("YYYY-MM-DD HH:mm:ss")}
      </span>
    ),
  },
  {
    id: "user",
    header: () => <HeaderText k="user" />,
    size: 240,
    minSize: 200,
    cell: ({ row }) => {
      const { userName, userEmail, userId } = row.original;
      // email is null once the user has been deleted — fall back to rendering a
      // truncated userId; ledger rows are kept de-identified (SET NULL), so
      // userId may be empty too
      if (!userEmail) {
        return (
          <span className="font-mono text-xs text-muted-foreground">
            {userId ? `${userId.slice(0, 12)}…` : "—"}
          </span>
        );
      }
      return (
        <div className="flex flex-col">
          <span className="font-medium">{userName || "-"}</span>
          <span
            className="text-muted-foreground cursor-pointer hover:underline"
            onClick={() => {
              navigator.clipboard.writeText(userEmail);
              toast.success("Copied");
            }}
          >
            {userEmail}
          </span>
        </div>
      );
    },
  },
  {
    accessorKey: "type",
    header: () => <HeaderText k="type" />,
    size: 170,
    minSize: 140,
    cell: ({ row }) => <TypeBadge type={row.original.type} />,
  },
  {
    accessorKey: "amount",
    header: () => <HeaderText k="amount" />,
    size: 110,
    minSize: 90,
    cell: ({ row }) => {
      const amount = row.original.amount;
      return (
        <span
          className={
            amount >= 0
              ? "tabular-nums text-green-600 dark:text-green-400"
              : "tabular-nums text-red-600 dark:text-red-400"
          }
        >
          {amount >= 0 ? `+${amount}` : amount}
        </span>
      );
    },
  },
  {
    id: "balanceAfter",
    header: () => <HeaderText k="balanceAfter" />,
    size: 180,
    minSize: 150,
    cell: ({ row }) => <BalanceAfterCell tx={row.original} />,
  },
  {
    accessorKey: "note",
    header: () => <HeaderText k="note" />,
    size: 260,
    minSize: 180,
    cell: ({ row }) => {
      const note = row.original.note;
      if (!note) return <span className="text-muted-foreground">—</span>;
      return (
        <span
          className="block max-w-[240px] truncate text-muted-foreground"
          title={note}
        >
          {note}
        </span>
      );
    },
  },
  {
    id: "actions",
    header: () => <ActionsHeaderText />,
    size: 80,
    minSize: 60,
    cell: ({ row }) => <ActionsCell tx={row.original} />,
  },
];
