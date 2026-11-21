/**
 * [INPUT]: Depends on @/actions/credits for the CreditHistoryPage type,
 *          @/lib/format for formatDate/formatNumber,
 *          @/components/ui/{badge,tooltip}, @tanstack/react-table
 * [OUTPUT]: Exports the getColumns column-definition factory and the
 *           CreditHistoryItem type
 * [POS]: The column definitions of dashboard/(user)/credit-history —
 *        consumed by CreditHistoryDataTable; type badges are colored by
 *        semantics, the amount column is colored by sign, and the two
 *        bucket balance snapshots each get their own column
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import type { CreditHistoryPage } from "@/actions/credits";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDate, formatNumber } from "@/lib/format";
import type { ColumnDef } from "@tanstack/react-table";

export type CreditHistoryItem = CreditHistoryPage["items"][number];

// ────────────────────────────────────────────────────────────────
//  Type badges — grants green, clawbacks red, usage/adjustments neutral;
//  unknown types degrade to an outline badge rendered as-is, so the UI
//  never breaks on a newly added enum value
// ────────────────────────────────────────────────────────────────

const GRANT_TYPES = new Set([
  "purchase",
  "subscription_grant",
  "usage_refund",
  "signup_bonus",
]);
const REVOKE_TYPES = new Set(["refund_revoke", "subscription_end_revoke"]);

function TypeBadge({ type, t }: { type: string; t: (key: string) => string }) {
  const labelKey = `type_${type}`;
  if (GRANT_TYPES.has(type)) {
    return (
      <Badge variant="default" className="bg-green-500 hover:bg-green-600">
        {t(labelKey)}
      </Badge>
    );
  }
  if (REVOKE_TYPES.has(type)) {
    return <Badge variant="destructive">{t(labelKey)}</Badge>;
  }
  if (type === "usage" || type === "admin_adjustment") {
    return <Badge variant="secondary">{t(labelKey)}</Badge>;
  }
  return <Badge variant="outline">{type}</Badge>;
}

export const getColumns = (
  t: (key: string) => string,
  locale: string
): ColumnDef<CreditHistoryItem>[] => [
  {
    accessorKey: "createdAt",
    header: t("header_date"),
    size: 180,
    minSize: 160,
    cell: ({ row }) => (
      <div className="whitespace-nowrap">
        {formatDate(row.original.createdAt, locale, {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </div>
    ),
  },
  {
    accessorKey: "type",
    header: t("header_type"),
    size: 160,
    minSize: 120,
    cell: ({ row }) => <TypeBadge type={row.original.type} t={t} />,
  },
  {
    accessorKey: "note",
    header: t("header_details"),
    size: 260,
    minSize: 180,
    cell: ({ row }) => {
      const note = row.original.note;
      if (!note) return <span className="text-muted-foreground">-</span>;
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="max-w-[220px] truncate">{note}</div>
            </TooltipTrigger>
            <TooltipContent>{note}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    },
  },
  {
    accessorKey: "amount",
    header: t("header_amount"),
    size: 120,
    minSize: 100,
    cell: ({ row }) => {
      const amount = row.original.amount;
      return (
        <div
          className={`font-medium tabular-nums ${
            amount > 0 ? "text-green-600" : amount < 0 ? "text-destructive" : ""
          }`}
        >
          {formatNumber(amount, locale, { signDisplay: "always" })}
        </div>
      );
    },
  },
  {
    accessorKey: "subscriptionCreditsAfter",
    header: t("header_balance_subscription"),
    size: 180,
    minSize: 160,
    cell: ({ row }) => (
      <div className="text-muted-foreground tabular-nums">
        {formatNumber(row.original.subscriptionCreditsAfter, locale)}
      </div>
    ),
  },
  {
    accessorKey: "purchasedCreditsAfter",
    header: t("header_balance_purchased"),
    size: 180,
    minSize: 160,
    cell: ({ row }) => (
      <div className="text-muted-foreground tabular-nums">
        {formatNumber(row.original.purchasedCreditsAfter, locale)}
      </div>
    ),
  },
];
