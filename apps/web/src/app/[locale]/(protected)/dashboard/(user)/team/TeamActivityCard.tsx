/**
 * [INPUT]: Depends on @/actions/team's getTeamCreditHistory,
 *          @/hooks/use-paged-query's usePagedQuery,
 *          @/components/shared's DataTableContainer/DataTableEmptyState/
 *          TablePagination,
 *          @/components/ui/{card,table,badge,button},
 *          @/lib/format's formatNumber, dayjs, the i18n Team namespace
 * [OUTPUT]: Exports the TeamActivityCard client component
 * [POS]: The team activity card of dashboard/(user)/team — consumed by
 *        TeamDashboard, a paginated table over the organization ledger
 *        (date/actor/type/amount/balance); loading states and the pagination
 *        bar go through the shared table kit, the same shape as the billing
 *        page's BillingHistory; a deleted actor renders a placeholder; a load
 *        failure is thrown into react-query's error channel and renders the
 *        retry state (swallowing it would cache an empty page as success —
 *        same law as TeamDashboard)
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import {
  getTeamCreditHistory,
  type TeamCreditHistoryItem,
} from "@/actions/team";
import {
  DataTableContainer,
  DataTableEmptyState,
} from "@/components/shared/data-table-container";
import { TablePagination } from "@/components/shared/table-elements";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePagedQuery } from "@/hooks/use-paged-query";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import dayjs from "dayjs";
import { Activity } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

const PAGE_SIZE = 10;

export function TeamActivityCard({
  organizationId,
}: {
  organizationId: string;
}) {
  const t = useTranslations("Team");
  const locale = useLocale();

  // Failures MUST throw: swallowing errors and returning an empty page would
  // be cached by react-query as successful data — the card would render
  // "no activity" forever with no retry channel (same law as TeamDashboard).
  const paged = usePagedQuery<TeamCreditHistoryItem>({
    queryKey: ["team-credit-history", organizationId],
    pageSize: PAGE_SIZE,
    fetchPage: async ({ pageIndex, pageSize }) => {
      const result = await getTeamCreditHistory({
        organizationId,
        pageIndex,
        pageSize,
      });
      if (!result.success || !result.data) {
        throw new Error(
          (!result.success && result.error) ||
            "Failed to load team credit history"
        );
      }
      return result.data;
    },
  });

  return (
    <Card className="gap-3 py-5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Activity className="size-4 text-primary" />
          {t("page.activity.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {paged.isError ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              {t("page.loadError")}
            </p>
            <Button variant="outline" size="sm" onClick={paged.refetch}>
              {t("page.retry")}
            </Button>
          </div>
        ) : (
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
                    <TableHead>{t("page.activity.columns.date")}</TableHead>
                    <TableHead>{t("page.activity.columns.actor")}</TableHead>
                    <TableHead>{t("page.activity.columns.type")}</TableHead>
                    <TableHead className="text-right">
                      {t("page.activity.columns.amount")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("page.activity.columns.balance")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.items.length === 0 ? (
                    <DataTableEmptyState
                      colSpan={5}
                      message={t("page.activity.empty")}
                    />
                  ) : (
                    paged.items.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {dayjs(entry.createdAt).format("YYYY-MM-DD HH:mm")}
                        </TableCell>
                        <TableCell className="max-w-[200px]">
                          {entry.actorName || entry.actorEmail ? (
                            <>
                              <span className="block truncate font-medium">
                                {entry.actorName ?? entry.actorEmail}
                              </span>
                              {entry.actorName && entry.actorEmail && (
                                <span className="block truncate text-xs text-muted-foreground">
                                  {entry.actorEmail}
                                </span>
                              )}
                            </>
                          ) : (
                            // userId was SET NULL by the account-deletion hook —
                            // the ledger row survives, the actor is anonymized
                            <span className="text-muted-foreground">
                              {t("page.activity.deletedMember")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {t.has(`page.activity.type.${entry.type}`)
                              ? t(`page.activity.type.${entry.type}`)
                              : entry.type}
                          </Badge>
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
                            {t("page.activity.balanceBreakdown", {
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

            {paged.pageCount > 1 && (
              <TablePagination
                pageIndex={paged.pageIndex}
                pageCount={paged.pageCount}
                totalItems={paged.total}
                isLoading={paged.isPlaceholderData}
                onPrevious={() => paged.setPageIndex(paged.pageIndex - 1)}
                onNext={() => paged.setPageIndex(paged.pageIndex + 1)}
                onPageChange={paged.setPageIndex}
                info={t("page.pagination.range", {
                  from: paged.pageIndex * PAGE_SIZE + 1,
                  to: Math.min(
                    (paged.pageIndex + 1) * PAGE_SIZE,
                    paged.total
                  ),
                  total: paged.total,
                })}
                navLabels={{
                  previous: t("page.pagination.previous"),
                  next: t("page.pagination.next"),
                }}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
