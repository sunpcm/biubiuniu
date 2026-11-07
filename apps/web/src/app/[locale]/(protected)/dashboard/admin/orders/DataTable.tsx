/**
 * [INPUT]: Depends on @/actions/orders/admin's getAdminOrders/AdminOrderItem,
 *          @/hooks/use-data-table's useDataTable (server-side pagination),
 *          the table container/toolbar/pinned columns of @/components/shared,
 *          ./RefundDialog, ./Columns' OrdersColumnMeta/PROVIDER_LABELS,
 *          next-intl's useTranslations
 * [OUTPUT]: Exports the OrdersDataTable component (provider/type/status filters
 *           + pagination + refund entry point)
 * [POS]: Data table layer of admin/orders; holds the RefundDialog state and
 *        injects onRefund into the column definitions through table meta — the
 *        orchestrator between page.tsx and Columns
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { AdminOrderItem, getAdminOrders } from "@/actions/orders/admin";
import { type PaymentProvider } from "@/config/pricing";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import { useDataTable } from "@/hooks/use-data-table";
import { OrderStatus, OrderType } from "@/lib/db/schema";
import {
  ColumnDef,
  ColumnPinningState,
  flexRender,
} from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { OrdersColumnMeta, PROVIDER_LABELS } from "./Columns";
import { RefundDialog } from "./RefundDialog";

// ──────────────────────────────────────────────
//  Constants — mirror the DB enums exactly
// ──────────────────────────────────────────────

const ORDER_STATUSES: OrderStatus[] = [
  "pending",
  "completed",
  "partially_refunded",
  "refunded",
  "failed",
];

const ORDER_TYPES: OrderType[] = [
  "one_time",
  "subscription_initial",
  "subscription_renewal",
  "subscription_upgrade",
];

const PROVIDERS: PaymentProvider[] = ["stripe", "paypal", "creem"];

interface OrderFilters {
  search: string;
  provider: string;
  orderType: string;
  status: string;
}

interface DataTableProps {
  columns: ColumnDef<AdminOrderItem, unknown>[];
  pageSize: number;
}

export function OrdersDataTable({ columns, pageSize }: DataTableProps) {
  const t = useTranslations("Orders");

  const [columnPinning] = useState<ColumnPinningState>({
    left: ["createdAt", "user"],
    right: ["actions"],
  });

  // ── refund dialog state ──
  const [refundOrder, setRefundOrder] = useState<AdminOrderItem | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);

  const openRefund = useCallback((order: AdminOrderItem) => {
    setRefundOrder(order);
    setRefundOpen(true);
  }, []);

  const {
    table,
    data,
    isLoading,
    isInitialLoading,
    isFetching,
    isPlaceholderData,
    pagination,
    totalCount,
    pageCount,
    filters,
    updateFilter,
    refetch,
  } = useDataTable<AdminOrderItem, OrderFilters>({
    columns,
    queryKey: ["admin-orders"],
    pageSize,
    initialFilters: {
      search: "",
      provider: "",
      orderType: "",
      status: "",
    },
    columnPinning,
    fetchData: async ({ pageIndex, pageSize, filters }) => {
      try {
        const result = await getAdminOrders({
          pageIndex,
          pageSize,
          search: filters.search || undefined,
          provider: (filters.provider as PaymentProvider) || undefined,
          orderType: (filters.orderType as OrderType) || undefined,
          status: (filters.status as OrderStatus) || undefined,
        });

        if (!result.success) {
          toast.error(t("toast.fetchFailed"), {
            description: result.error,
          });
          return null;
        }

        if (result.data) {
          return {
            data: result.data.items,
            totalCount: result.data.total,
          };
        }

        return null;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        toast.error(t("toast.fetchFailed"), { description: message });
        return null;
      }
    },
  });

  // --- inject callbacks into table meta so columns can call them ---
  const tableMeta: OrdersColumnMeta = useMemo(
    () => ({ onRefund: openRefund }),
    [openRefund]
  );
  table.options.meta = tableMeta;

  const hasData = data.length > 0;

  // ── filter select configs ──
  const filterSelects = useMemo(
    () => [
      {
        key: "provider" as const,
        label: t("filters.allProviders"),
        placeholder: t("filters.providerPlaceholder"),
        options: PROVIDERS,
        format: (v: string) => PROVIDER_LABELS[v as PaymentProvider],
      },
      {
        key: "orderType" as const,
        label: t("filters.allTypes"),
        placeholder: t("filters.typePlaceholder"),
        options: ORDER_TYPES,
        format: (v: string) => t(`orderType.${v}`),
      },
      {
        key: "status" as const,
        label: t("filters.allStatuses"),
        placeholder: t("filters.statusPlaceholder"),
        options: ORDER_STATUSES,
        format: (v: string) => t(`status.${v}`),
      },
    ],
    [t]
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <DataTableToolbar onRefresh={refetch} isRefreshing={isFetching}>
        <Input
          placeholder={t("searchPlaceholder")}
          value={filters.search}
          onChange={(event) => updateFilter("search", event.target.value)}
          className="h-8 max-w-sm"
        />
        {filterSelects.map((select) => (
          <Select
            key={select.key}
            value={filters[select.key] || "all"}
            onValueChange={(value) =>
              updateFilter(select.key, value === "all" ? "" : value)
            }
          >
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder={select.placeholder} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{select.label}</SelectItem>
              {select.options.map((option) => (
                <SelectItem key={option} value={option}>
                  {select.format(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
      </DataTableToolbar>

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
                  <PinnedTableHead key={header.id} header={header}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </PinnedTableHead>
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
              <DataTableEmptyState colSpan={columns.length} />
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

      <RefundDialog
        order={refundOrder}
        open={refundOpen}
        onOpenChange={setRefundOpen}
        onSuccess={refetch}
      />
    </div>
  );
}
