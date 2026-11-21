/**
 * [INPUT]: Depends on @/actions/orders/user for getMyOrders (planName already
 *          resolved server-side per locale), @/actions/credits for
 *          getMyCreditHistory,
 *          @/hooks/use-paged-query for usePagedQuery,
 *          @/components/shared for DataTableContainer/DataTableEmptyState/
 *          TablePagination,
 *          @/lib/format for formatCents/formatNumber/formatDate,
 *          @/components/ui/{tabs,table,badge}, next-intl
 * [OUTPUT]: Exports the BillingHistory component
 * [POS]: The history section of dashboard/(user)/billing — consumed by page.tsx,
 *        two paginated tables: purchase records (orders, with provider and
 *        refund state) and the credit ledger (per-bucket balance snapshots);
 *        loading states and the pagination bar go through the shared table
 *        kit, the same shape as the admin tables
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { getMyCreditHistory, type CreditHistoryPage } from "@/actions/credits";
import { getMyOrders, type MyOrderItem } from "@/actions/orders/user";
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
import { formatCents, formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

const PAGE_SIZE = 10;

/** Payment providers are brand names — rendered as-is, never translated. */
const PROVIDER_LABELS: Record<string, string> = {
  stripe: "Stripe",
  creem: "Creem",
  paypal: "PayPal",
};

const DATE_TIME: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
};

// actions/credits only exports the page type; derive the row type here rather
// than spelling the fields out a second time
type CreditHistoryItem = CreditHistoryPage["items"][number];

// ----------------------------------------------------------------------------
// Shared pagination footer — only supplies the Billing namespace translations,
// the shape belongs to the shared component
// ----------------------------------------------------------------------------

function HistoryPagination({
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
  const t = useTranslations("Billing");
  if (pageCount <= 1) return null;

  return (
    <TablePagination
      pageIndex={pageIndex}
      pageCount={pageCount}
      totalItems={total}
      isLoading={isLoading}
      onPrevious={() => onPageChange(pageIndex - 1)}
      onNext={() => onPageChange(pageIndex + 1)}
      onPageChange={onPageChange}
      info={t("pagination.range", {
        from: pageIndex * PAGE_SIZE + 1,
        to: Math.min((pageIndex + 1) * PAGE_SIZE, total),
        total,
      })}
      navLabels={{
        previous: t("pagination.previous"),
        next: t("pagination.next"),
      }}
    />
  );
}

// ----------------------------------------------------------------------------
// Purchase history — provider + refund state included
// ----------------------------------------------------------------------------

function OrdersTable() {
  const t = useTranslations("Billing");
  const locale = useLocale();

  // Failures toast instead of throwing: the rest of the billing page stays
  // usable, the user does not get a whole error state for one page of rows
  const paged = usePagedQuery<MyOrderItem>({
    queryKey: ["billing-orders"],
    pageSize: PAGE_SIZE,
    fetchPage: async ({ pageIndex, pageSize }) => {
      const result = await getMyOrders({ pageIndex, pageSize });
      if (!result.success) {
        toast.error(result.error || t("loadError"));
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
        maxHeight="calc(100vh - 320px)"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("orders.columns.date")}</TableHead>
              <TableHead>{t("orders.columns.plan")}</TableHead>
              <TableHead>{t("orders.columns.type")}</TableHead>
              <TableHead>{t("orders.columns.provider")}</TableHead>
              <TableHead className="text-right">
                {t("orders.columns.credits")}
              </TableHead>
              <TableHead className="text-right">
                {t("orders.columns.amount")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.items.length === 0 ? (
              <DataTableEmptyState colSpan={6} message={t("orders.empty")} />
            ) : (
              paged.items.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(order.createdAt, locale, DATE_TIME)}
                  </TableCell>
                  <TableCell className="font-medium">{order.planName}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {t(`orders.type.${order.orderType}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {PROVIDER_LABELS[order.provider] ?? order.provider}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(order.creditsGranted, locale)}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="tabular-nums">
                      {formatCents(order.amountTotal, order.currency, locale)}
                    </span>
                    {order.status !== "completed" && (
                      <div
                        className={cn(
                          "mt-0.5 text-xs",
                          // pending is a neutral in-flight state (eCheck clearing),
                          // not an alarm — only refunds and failures go red
                          order.status === "pending"
                            ? "text-muted-foreground"
                            : "text-destructive"
                        )}
                      >
                        {t(`orders.status.${order.status}`)}
                        {order.amountRefunded > 0 && (
                          <>
                            {" · "}
                            {t("orders.refundedAmount", {
                              amount: formatCents(
                                order.amountRefunded,
                                order.currency,
                                locale
                              ),
                            })}
                          </>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DataTableContainer>
      <HistoryPagination
        pageIndex={paged.pageIndex}
        pageCount={paged.pageCount}
        total={paged.total}
        isLoading={paged.isPlaceholderData}
        onPageChange={paged.setPageIndex}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Credit ledger history
// ----------------------------------------------------------------------------

function CreditHistoryTable() {
  const t = useTranslations("Billing");
  const locale = useLocale();

  const paged = usePagedQuery<CreditHistoryItem>({
    queryKey: ["billing-credit-history"],
    pageSize: PAGE_SIZE,
    fetchPage: async ({ pageIndex, pageSize }) => {
      const result = await getMyCreditHistory({ pageIndex, pageSize });
      if (!result.success) {
        toast.error(result.error || t("loadError"));
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
        maxHeight="calc(100vh - 320px)"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("credits.columns.date")}</TableHead>
              <TableHead>{t("credits.columns.type")}</TableHead>
              <TableHead>{t("credits.columns.note")}</TableHead>
              <TableHead className="text-right">
                {t("credits.columns.amount")}
              </TableHead>
              <TableHead className="text-right">
                {t("credits.columns.balance")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.items.length === 0 ? (
              <DataTableEmptyState colSpan={5} message={t("credits.empty")} />
            ) : (
              paged.items.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(entry.createdAt, locale, DATE_TIME)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {t(`credits.type.${entry.type}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate text-muted-foreground">
                    {entry.note ?? "-"}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-medium tabular-nums",
                      entry.amount > 0 &&
                        "text-emerald-600 dark:text-emerald-400",
                      entry.amount < 0 && "text-destructive"
                    )}
                  >
                    {formatNumber(entry.amount, locale, {
                      signDisplay: "always",
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="tabular-nums font-medium">
                      {formatNumber(
                        entry.subscriptionCreditsAfter +
                          entry.purchasedCreditsAfter,
                        locale
                      )}
                    </span>
                    <div className="text-xs text-muted-foreground">
                      {t("credits.balanceBreakdown", {
                        subscription: entry.subscriptionCreditsAfter,
                        purchased: entry.purchasedCreditsAfter,
                      })}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DataTableContainer>
      <HistoryPagination
        pageIndex={paged.pageIndex}
        pageCount={paged.pageCount}
        total={paged.total}
        isLoading={paged.isPlaceholderData}
        onPageChange={paged.setPageIndex}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Tabs shell — the panels carry no card frame of their own: the table
// container's border is the edge of this area, the same look as the admin
// tables (an outer frame on top of it would be a double border)
// ----------------------------------------------------------------------------

export function BillingHistory() {
  const t = useTranslations("Billing");

  return (
    <Tabs defaultValue="orders">
      <TabsList>
        <TabsTrigger value="orders">{t("tabs.orders")}</TabsTrigger>
        <TabsTrigger value="credits">{t("tabs.credits")}</TabsTrigger>
      </TabsList>
      <TabsContent value="orders" className="mt-4">
        <OrdersTable />
      </TabsContent>
      <TabsContent value="credits" className="mt-4">
        <CreditHistoryTable />
      </TabsContent>
    </Tabs>
  );
}
