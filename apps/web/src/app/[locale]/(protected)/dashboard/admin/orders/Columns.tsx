/**
 * [INPUT]: Depends on @/actions/orders/admin for AdminOrderItem, @/lib/format for formatCents,
 *          @/config/pricing for PaymentProvider, next-intl for useTranslations/useLocale,
 *          @/components/ui for Badge/Button/DropdownMenu, @tanstack/react-table for ColumnDef
 * [OUTPUT]: Exports columns (order table column definitions), OrdersColumnMeta, PROVIDER_LABELS
 * [POS]: Column definitions of admin/orders, consumed by DataTable; the refund action
 *        goes through a table-meta callback so DataTable opens RefundDialog — the
 *        columns themselves hold no business state
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { AdminOrderItem } from "@/actions/orders/admin";
import { type PaymentProvider } from "@/config/pricing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCents } from "@/lib/format";
import { OrderStatus, OrderType } from "@/lib/db/schema";
import { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import { MoreHorizontal } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

// ──────────────────────────────────────────────
//  Table meta — DataTable injects callbacks here
// ──────────────────────────────────────────────

export interface OrdersColumnMeta {
  onRefund?: (order: AdminOrderItem) => void;
}

// ──────────────────────────────────────────────
//  Provider labels — brand names, no i18n needed
// ──────────────────────────────────────────────

export const PROVIDER_LABELS: Record<PaymentProvider, string> = {
  stripe: "Stripe",
  paypal: "PayPal",
  creem: "Creem",
};

// ──────────────────────────────────────────────
//  Badge palettes — one map, no branching
// ──────────────────────────────────────────────

const STATUS_BADGE_CLASS: Record<OrderStatus, string> = {
  pending:
    "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  completed:
    "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400",
  partially_refunded:
    "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  refunded: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  failed:
    "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400",
};

// ──────────────────────────────────────────────
//  Cell components — rendered via flexRender,
//  so next-intl hooks are safe here
// ──────────────────────────────────────────────

const HeaderText = ({ k }: { k: string }) => {
  const t = useTranslations("Orders");
  return <>{t(`columns.${k}`)}</>;
};

const OrderTypeBadge = ({ orderType }: { orderType: OrderType }) => {
  const t = useTranslations("Orders");
  return <Badge variant="outline">{t(`orderType.${orderType}`)}</Badge>;
};

const StatusBadge = ({ status }: { status: OrderStatus }) => {
  const t = useTranslations("Orders");
  return (
    <Badge variant="outline" className={STATUS_BADGE_CLASS[status]}>
      {t(`status.${status}`)}
    </Badge>
  );
};

const AmountCell = ({ order }: { order: AdminOrderItem }) => {
  const t = useTranslations("Orders");
  const locale = useLocale();
  return (
    <div className="flex flex-col">
      <span>{formatCents(order.amountTotal, order.currency, locale)}</span>
      {order.amountRefunded > 0 && (
        <span className="text-xs text-red-600 dark:text-red-400">
          {t("columns.refunded")}:{" "}
          {formatCents(order.amountRefunded, order.currency, locale)}
        </span>
      )}
    </div>
  );
};

const ActionsCell = ({
  order,
  onRefund,
}: {
  order: AdminOrderItem;
  onRefund?: (order: AdminOrderItem) => void;
}) => {
  const t = useTranslations("Orders");

  // Refundable = money already settled: pending/failed have nothing settled, refunded is fully returned.
  const refundDisabled =
    !order.providerPaymentId ||
    order.status === "refunded" ||
    order.status === "pending" ||
    order.status === "failed";

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
            navigator.clipboard.writeText(order.id);
            toast.success(t("toast.copied"));
          }}
        >
          {t("actions.copyOrderId")}
        </DropdownMenuItem>
        {order.providerPaymentId && (
          <DropdownMenuItem
            onClick={() => {
              navigator.clipboard.writeText(order.providerPaymentId!);
              toast.success(t("toast.copied"));
            }}
          >
            {t("actions.copyPaymentId")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          disabled={refundDisabled}
          onClick={() => onRefund?.(order)}
        >
          {t("actions.refund")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

// ──────────────────────────────────────────────
//  Column definitions
// ──────────────────────────────────────────────

export const columns: ColumnDef<AdminOrderItem>[] = [
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
      // Payer deleted their account: the order stays, the payer is de-identified — fall back to a truncated userId
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
    accessorKey: "planId",
    header: () => <HeaderText k="planId" />,
    size: 160,
    minSize: 130,
    cell: ({ row }) => (
      <span className="font-mono text-xs">{row.original.planId}</span>
    ),
  },
  {
    accessorKey: "orderType",
    header: () => <HeaderText k="orderType" />,
    size: 170,
    minSize: 140,
    cell: ({ row }) => <OrderTypeBadge orderType={row.original.orderType} />,
  },
  {
    accessorKey: "provider",
    header: () => <HeaderText k="provider" />,
    size: 110,
    minSize: 90,
    cell: ({ row }) => (
      <Badge variant="outline">{PROVIDER_LABELS[row.original.provider]}</Badge>
    ),
  },
  {
    accessorKey: "creditsGranted",
    header: () => <HeaderText k="credits" />,
    size: 110,
    minSize: 90,
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.creditsGranted}</span>
    ),
  },
  {
    accessorKey: "amountTotal",
    header: () => <HeaderText k="amount" />,
    size: 150,
    minSize: 120,
    cell: ({ row }) => <AmountCell order={row.original} />,
  },
  {
    accessorKey: "status",
    header: () => <HeaderText k="status" />,
    size: 150,
    minSize: 120,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    id: "actions",
    header: () => <HeaderText k="actions" />,
    size: 80,
    minSize: 60,
    cell: ({ row, table }) => {
      const meta = table.options.meta as OrdersColumnMeta | undefined;
      return <ActionsCell order={row.original} onRefund={meta?.onRefund} />;
    },
  },
];
