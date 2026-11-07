/**
 * [INPUT]: Depends on @/actions/credits/admin for getAdminCreditTransactions/
 *          AdminCreditTransactionItem, @/hooks/use-data-table for useDataTable
 *          (server-side pagination), @/components/shared for the table
 *          container/toolbar/pinned columns, ./BatchGrantDialog, next-intl for
 *          useTranslations
 * [OUTPUT]: exports the CreditsDataTable component (filters + pagination +
 *           batch grant entry point)
 * [POS]: The data-table layer of admin/credits; owns BatchGrantDialog state
 *        and refetches the ledger once a grant succeeds — the orchestrator
 *        between page.tsx and Columns
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import {
  AdminCreditTransactionItem,
  getAdminCreditTransactions,
} from "@/actions/credits/admin";
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
import { Button } from "@/components/ui/button";
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
import { CreditTransactionType } from "@/lib/db/schema";
import {
  ColumnDef,
  ColumnPinningState,
  flexRender,
} from "@tanstack/react-table";
import { Gift } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { BatchGrantDialog } from "./BatchGrantDialog";

// ──────────────────────────────────────────────
//  Constants — mirror the DB enum exactly
// ──────────────────────────────────────────────

const TRANSACTION_TYPES: CreditTransactionType[] = [
  "purchase",
  "subscription_grant",
  "subscription_cycle_expire",
  "usage",
  "usage_refund",
  "refund_revoke",
  "subscription_end_revoke",
  "admin_adjustment",
  "signup_bonus",
];

interface CreditFilters {
  search: string;
  type: string;
}

interface DataTableProps {
  columns: ColumnDef<AdminCreditTransactionItem, unknown>[];
  pageSize: number;
}

export function CreditsDataTable({ columns, pageSize }: DataTableProps) {
  const t = useTranslations("Credits");

  const [columnPinning] = useState<ColumnPinningState>({
    left: ["createdAt", "user"],
    right: ["actions"],
  });

  // ── batch grant dialog state ──
  const [grantOpen, setGrantOpen] = useState(false);

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
  } = useDataTable<AdminCreditTransactionItem, CreditFilters>({
    columns,
    queryKey: ["admin-credit-transactions"],
    pageSize,
    initialFilters: {
      search: "",
      type: "",
    },
    columnPinning,
    fetchData: async ({ pageIndex, pageSize, filters }) => {
      try {
        const result = await getAdminCreditTransactions({
          pageIndex,
          pageSize,
          search: filters.search || undefined,
          type: (filters.type as CreditTransactionType) || undefined,
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

  const hasData = data.length > 0;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <DataTableToolbar
        onRefresh={refetch}
        isRefreshing={isFetching}
        actions={
          <Button
            size="sm"
            className="h-8"
            onClick={() => setGrantOpen(true)}
          >
            <Gift className="h-4 w-4" />
            {t("batchGrant.button")}
          </Button>
        }
      >
        <Input
          placeholder={t("searchPlaceholder")}
          value={filters.search}
          onChange={(event) => updateFilter("search", event.target.value)}
          className="h-8 max-w-sm"
        />
        <Select
          value={filters.type || "all"}
          onValueChange={(value) =>
            updateFilter("type", value === "all" ? "" : value)
          }
        >
          <SelectTrigger className="w-[180px] h-8 text-xs">
            <SelectValue placeholder={t("filters.typePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filters.allTypes")}</SelectItem>
            {TRANSACTION_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`type.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

      <BatchGrantDialog
        open={grantOpen}
        onOpenChange={setGrantOpen}
        onSuccess={refetch}
      />
    </div>
  );
}
