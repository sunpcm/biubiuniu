/**
 * [INPUT]: Depends on the MyOrderItem type from @/actions/orders/user,
 *          formatCents/formatDate/formatNumber from @/lib/format,
 *          @/components/ui/badge, @tanstack/react-table
 * [OUTPUT]: Exports the getColumns column-definition factory
 * [POS]: The column definitions of dashboard/(user)/my-orders — consumed by
 *        DataTable; amounts are integer cents (formatCents), a refunded state
 *        appends the refunded amount, provider is a brand name and is not
 *        translated
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import type { MyOrderItem } from "@/actions/orders/user";
import { Badge } from "@/components/ui/badge";
import { formatCents, formatDate, formatNumber } from "@/lib/format";
import type { ColumnDef } from "@tanstack/react-table";

/** Payment providers are brand names — rendered as-is, never translated. */
const PROVIDER_LABELS: Record<string, string> = {
  stripe: "Stripe",
  creem: "Creem",
  paypal: "PayPal",
};

export const getColumns = (
  t: (key: string) => string,
  locale: string
): ColumnDef<MyOrderItem>[] => [
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
    accessorKey: "planName",
    header: t("header_plan"),
    size: 200,
    minSize: 160,
    cell: ({ row }) => (
      <div className="max-w-[200px] truncate font-medium">
        {row.original.planName}
      </div>
    ),
  },
  {
    accessorKey: "orderType",
    header: t("header_type"),
    size: 140,
    minSize: 120,
    cell: ({ row }) => (
      <Badge variant="outline">{t(`type_${row.original.orderType}`)}</Badge>
    ),
  },
  {
    accessorKey: "provider",
    header: t("header_provider"),
    size: 120,
    minSize: 100,
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {PROVIDER_LABELS[row.original.provider] ?? row.original.provider}
      </span>
    ),
  },
  {
    accessorKey: "creditsGranted",
    header: t("header_credits"),
    size: 120,
    minSize: 100,
    cell: ({ row }) => (
      <div className="tabular-nums">
        {formatNumber(row.original.creditsGranted, locale)}
      </div>
    ),
  },
  {
    accessorKey: "amountTotal",
    header: t("header_amount"),
    size: 160,
    minSize: 130,
    cell: ({ row }) => {
      const { amountTotal, amountRefunded, currency } = row.original;
      return (
        <div className="flex flex-col">
          <span className="tabular-nums">
            {formatCents(amountTotal, currency, locale)}
          </span>
          {amountRefunded > 0 && (
            <span className="text-xs text-destructive">
              {t("refunded_prefix")}{" "}
              {formatCents(amountRefunded, currency, locale)}
            </span>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "status",
    header: t("header_status"),
    size: 150,
    minSize: 120,
    cell: ({ row }) => {
      const status = row.original.status;
      // pending is a neutral in-flight state (eCheck clearing) — it must not
      // render as alarm red.
      const variant =
        status === "completed"
          ? "secondary"
          : status === "pending"
            ? "outline"
            : "destructive";
      return <Badge variant={variant}>{t(`status_${status}`)}</Badge>;
    },
  },
];
