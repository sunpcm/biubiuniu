/**
 * [INPUT]: Depends on getMyOrders/MyOrderItem of @/actions/orders/user,
 *          useDataTable of @/hooks/use-data-table,
 *          the data-table component family of @/components/shared, ./Columns
 * [OUTPUT]: Exports the MyOrdersDataTable component
 * [POS]: The table container of dashboard/(user)/my-orders — consumed by
 *        page.tsx; the new order contract has no server-side filter params,
 *        only pagination + refresh
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { getMyOrders, type MyOrderItem } from "@/actions/orders/user";
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
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import { useDataTable } from "@/hooks/use-data-table";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { toast } from "sonner";
import { getColumns } from "./Columns";

interface DataTableProps {
  pageSize: number;
}

export function MyOrdersDataTable({ pageSize }: DataTableProps) {
  const t = useTranslations("MyOrders");
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
    refetch,
  } = useDataTable<MyOrderItem, Record<string, never>>({
    columns,
    queryKey: ["my-orders"],
    pageSize,
    fetchData: async ({ pageIndex, pageSize }) => {
      const result = await getMyOrders({ pageIndex, pageSize });

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
      <DataTableToolbar onRefresh={refetch} isRefreshing={isFetching} />

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
