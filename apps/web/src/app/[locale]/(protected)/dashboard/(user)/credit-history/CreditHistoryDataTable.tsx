/**
 * [INPUT]: Depends on @/actions/credits' getMyCreditHistory,
 *          @/lib/db/schema's CreditTransactionType (type only),
 *          @/hooks/use-data-table's useDataTable,
 *          the data-table component family of @/components/shared, ./Columns
 * [OUTPUT]: Exports the CreditHistoryDataTable component
 * [POS]: Table container of dashboard/(user)/credit-history — consumed by
 *        page.tsx; type dropdown filter (server-side type param) + pagination
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { getMyCreditHistory } from "@/actions/credits";
import {
  DataTableContainer,
  DataTableEmptyState,
} from "@/components/shared/data-table-container";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import {
  PinnedTableCell,
  PinnedTableHead,
} from "@/components/shared/pinned-column";
import { TablePagination } from "@/components/shared/table-elements";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import { useDataTable } from "@/hooks/use-data-table";
import type { CreditTransactionType } from "@/lib/db/schema";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { toast } from "sonner";
import { getColumns, type CreditHistoryItem } from "./Columns";

// subscription_cycle_expire is a bookkeeping row already filtered out
// server-side — it never enters the filter
const FILTER_TYPES = [
  "purchase",
  "subscription_grant",
  "usage",
  "usage_refund",
  "refund_revoke",
  "subscription_end_revoke",
  "admin_adjustment",
  "signup_bonus",
] as const satisfies readonly CreditTransactionType[];

interface CreditHistoryDataTableProps {
  pageSize?: number;
}

export function CreditHistoryDataTable({
  pageSize = 20,
}: CreditHistoryDataTableProps) {
  const t = useTranslations("CreditHistory");
  const locale = useLocale();

  const columns = useMemo(() => getColumns(t, locale), [t, locale]);

  const {
    table,
    data,
    isLoading,
    isInitialLoading,
    isFetching,
    isPlaceholderData,
    isError,
    error,
    pagination,
    totalCount,
    pageCount,
    filters,
    updateFilter,
    refetch,
  } = useDataTable<CreditHistoryItem, { type: string }>({
    columns,
    queryKey: ["credit-history"],
    pageSize,
    initialFilters: { type: "" },
    fetchData: async ({ pageIndex, pageSize, filters }) => {
      const result = await getMyCreditHistory({
        pageIndex,
        pageSize,
        type: (filters.type || undefined) as CreditTransactionType | undefined,
      });

      if (result.success && result.data) {
        return {
          data: result.data.items,
          totalCount: result.data.total,
        };
      }

      if (!result.success) {
        toast.error(t("load_error"), { description: result.error });
      }

      return null;
    },
  });

  const hasData = data.length > 0;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <DataTableToolbar onRefresh={refetch} isRefreshing={isFetching}>
        <Select
          value={filters.type || "all"}
          onValueChange={(value) =>
            updateFilter("type", value === "all" ? "" : value)
          }
        >
          <SelectTrigger className="w-[200px] h-8 text-xs">
            <SelectValue placeholder={t("filter_type_all")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filter_type_all")}</SelectItem>
            {FILTER_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`type_${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </DataTableToolbar>

      {isError && error && (
        <div className="text-sm text-destructive">{error.message}</div>
      )}

      <DataTableContainer
        isInitialLoading={isInitialLoading}
        isFetching={isPlaceholderData}
        hasData={hasData}
        columnCount={columns.length}
        fillAvailableSpace
      >
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <PinnedTableHead key={header.id} header={header} />
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <PinnedTableCell key={cell.id} cell={cell} />
                  ))}
                </TableRow>
              ))
            ) : (
              <DataTableEmptyState
                colSpan={columns.length}
                message={t("no_records")}
              />
            )}
          </TableBody>
        </Table>
      </DataTableContainer>

      <TablePagination
        pageIndex={pagination.pageIndex}
        pageCount={pageCount}
        totalItems={totalCount}
        isLoading={isLoading}
        onPrevious={() => table.previousPage()}
        onNext={() => table.nextPage()}
        pageSize={pagination.pageSize}
        onPageSizeChange={(size) => table.setPageSize(size)}
        onPageChange={(index) => table.setPageIndex(index)}
        showFirstLast={pageCount > 5}
        infoMode="range"
      />
    </div>
  );
}
