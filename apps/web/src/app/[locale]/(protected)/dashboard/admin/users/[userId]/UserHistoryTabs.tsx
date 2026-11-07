/**
 * [INPUT]: Depends on @/actions/credits/admin for getAdminCreditTransactions/
 *          AdminCreditTransactionItem, @/actions/orders/admin for getAdminOrders/
 *          AdminOrderItem, @/lib/format for formatCents,
 *          @/hooks/use-paged-query for usePagedQuery,
 *          @/components/shared for DataTableContainer/DataTableEmptyState/
 *          TablePagination,
 *          @/components/ui for Tabs/Table/Badge, dayjs, next-intl
 * [OUTPUT]: exports the UserHistoryTabs component (one user's credit ledger + order history)
 * [POS]: History section of admin/users/[userId] — consumed by page.tsx,
 *        two paginated tables of 20 rows/page; loading states and the
 *        pagination bar go through the shared table kit, styled to match the
 *        admin/credits and admin/orders lists
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import {
  AdminCreditTransactionItem,
  getAdminCreditTransactions,
} from "@/actions/credits/admin";
import { AdminOrderItem, getAdminOrders } from "@/actions/orders/admin";
import {
  DataTableContainer,
  DataTableEmptyState,
} from "@/components/shared/data-table-container";
import { TablePagination } from "@/components/shared/table-elements";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePagedQuery } from "@/hooks/use-paged-query";
import { CreditTransactionType, OrderStatus } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import dayjs from "dayjs";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { formatCents } from "@/lib/format";

const PAGE_SIZE = 20;

// ──────────────────────────────────────────────
//  Badge palettes — mirror admin/credits and
//  admin/orders Columns (maps are not exported)
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
//  Shared table chrome
// ──────────────────────────────────────────────

function Footer({
  pageIndex,
  pageCount,
  total,
  isLoading,
  onPageChange,
}: {
  pageIndex: number;
  pageCount: number;
  total: number;
  isLoading: boolean;
  onPageChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;

  return (
    <TablePagination
      pageIndex={pageIndex}
      pageCount={pageCount}
      totalItems={total}
      pageSize={PAGE_SIZE}
      isLoading={isLoading}
      onPrevious={() => onPageChange(pageIndex - 1)}
      onNext={() => onPageChange(pageIndex + 1)}
      onPageChange={onPageChange}
      infoMode="range"
    />
  );
}

// ──────────────────────────────────────────────
//  Credit ledger — Credits namespace labels
// ──────────────────────────────────────────────

function CreditsTable({ userId }: { userId: string }) {
  const t = useTranslations("Credits");

  const paged = usePagedQuery<AdminCreditTransactionItem>({
    queryKey: ["admin-user-credit-tx", userId],
    pageSize: PAGE_SIZE,
    fetchPage: async ({ pageIndex, pageSize }) => {
      const result = await getAdminCreditTransactions({
        pageIndex,
        pageSize,
        userId,
      });
      if (!result.success) {
        toast.error(result.error);
        return { items: [], total: 0 };
      }
      return result.data ?? { items: [], total: 0 };
    },
  });

  return (
    <div className="space-y-4">
      <DataTableContainer
        isInitialLoading={paged.isInitialLoading}
        isFetching={paged.isPlaceholderData}
        hasData={paged.hasData}
        columnCount={5}
        maxHeight="calc(100vh - 360px)"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.createdAt")}</TableHead>
              <TableHead>{t("columns.type")}</TableHead>
              <TableHead className="text-right">{t("columns.amount")}</TableHead>
              <TableHead className="text-right">
                {t("columns.balanceAfter")}
              </TableHead>
              <TableHead>{t("columns.note")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.items.length === 0 ? (
              <DataTableEmptyState colSpan={5} />
            ) : (
              paged.items.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {dayjs(tx.createdAt).format("YYYY-MM-DD HH:mm")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={TYPE_BADGE_CLASS[tx.type]}>
                      {t(`type.${tx.type}`)}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-medium tabular-nums",
                      tx.amount >= 0
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    )}
                  >
                    {tx.amount >= 0 ? `+${tx.amount}` : tx.amount}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-medium tabular-nums">
                      {tx.subscriptionCreditsAfter + tx.purchasedCreditsAfter}
                    </span>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {t("balanceBreakdown", {
                        subscription: tx.subscriptionCreditsAfter,
                        purchased: tx.purchasedCreditsAfter,
                      })}
                    </div>
                  </TableCell>
                  <TableCell>
                    {tx.note ? (
                      <span
                        className="block max-w-[280px] truncate text-muted-foreground"
                        title={tx.note}
                      >
                        {tx.note}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DataTableContainer>
      <Footer
        pageIndex={paged.pageIndex}
        pageCount={paged.pageCount}
        total={paged.total}
        isLoading={paged.isPlaceholderData}
        onPageChange={paged.setPageIndex}
      />
    </div>
  );
}

// ──────────────────────────────────────────────
//  Orders — Orders namespace labels
// ──────────────────────────────────────────────

function OrdersTable({ userId }: { userId: string }) {
  const t = useTranslations("Orders");
  const locale = useLocale();

  const paged = usePagedQuery<AdminOrderItem>({
    queryKey: ["admin-user-orders", userId],
    pageSize: PAGE_SIZE,
    fetchPage: async ({ pageIndex, pageSize }) => {
      const result = await getAdminOrders({ pageIndex, pageSize, userId });
      if (!result.success) {
        toast.error(result.error);
        return { items: [], total: 0 };
      }
      return result.data ?? { items: [], total: 0 };
    },
  });

  return (
    <div className="space-y-4">
      <DataTableContainer
        isInitialLoading={paged.isInitialLoading}
        isFetching={paged.isPlaceholderData}
        hasData={paged.hasData}
        columnCount={6}
        maxHeight="calc(100vh - 360px)"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.createdAt")}</TableHead>
              <TableHead>{t("columns.planId")}</TableHead>
              <TableHead>{t("columns.orderType")}</TableHead>
              <TableHead className="text-right">{t("columns.credits")}</TableHead>
              <TableHead className="text-right">{t("columns.amount")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.items.length === 0 ? (
              <DataTableEmptyState colSpan={6} />
            ) : (
              paged.items.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {dayjs(order.createdAt).format("YYYY-MM-DD HH:mm")}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{order.planId}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {t(`orderType.${order.orderType}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {order.creditsGranted}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="tabular-nums">
                      {formatCents(order.amountTotal, order.currency, locale)}
                    </span>
                    {order.amountRefunded > 0 && (
                      <div className="text-xs text-red-600 dark:text-red-400">
                        {t("columns.refunded")}:{" "}
                        {formatCents(order.amountRefunded, order.currency, locale)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={STATUS_BADGE_CLASS[order.status]}
                    >
                      {t(`status.${order.status}`)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DataTableContainer>
      <Footer
        pageIndex={paged.pageIndex}
        pageCount={paged.pageCount}
        total={paged.total}
        isLoading={paged.isPlaceholderData}
        onPageChange={paged.setPageIndex}
      />
    </div>
  );
}

// ──────────────────────────────────────────────
//  Tabs shell — no card frame of its own: the
//  table container's border is the only edge
// ──────────────────────────────────────────────

export function UserHistoryTabs({ userId }: { userId: string }) {
  const t = useTranslations("Users");

  return (
    <Tabs defaultValue="credits">
      <TabsList>
        <TabsTrigger value="credits">{t("detail.tabs.credits")}</TabsTrigger>
        <TabsTrigger value="orders">{t("detail.tabs.orders")}</TabsTrigger>
      </TabsList>
      <TabsContent value="credits" className="mt-4">
        <CreditsTable userId={userId} />
      </TabsContent>
      <TabsContent value="orders" className="mt-4">
        <OrdersTable userId={userId} />
      </TabsContent>
    </Tabs>
  );
}
