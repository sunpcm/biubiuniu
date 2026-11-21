/**
 * [INPUT]: Depends on @/actions/coupons/admin's getAdminPromotionCodes /
 *          setPromotionCodeActive, @/hooks/use-data-table's useDataTable,
 *          the table container/toolbar/pinned columns of @/components/shared,
 *          ./Columns' CouponsColumnMeta, ./CouponFormDialog, ./schemas'
 *          toFormValues / UNRESTRICTED_FILTER, @/config/pricing
 * [OUTPUT]: Exports the CouponsDataTable component (search + status/plan filters
 *           + pagination + create/duplicate entry points + enable toggle)
 * [POS]: Data table layer of admin/coupons, mounted by page.tsx. It owns the
 *        dialog state and passes the row callbacks to Columns through table
 *        meta; with Stripe unconfigured it renders the reason instead of an
 *        empty table, because there is nothing to retry.
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import {
  getAdminPromotionCodes,
  setPromotionCodeActive,
  type AdminPromotionCodeItem,
  type PromotionCodeStatus,
} from "@/actions/coupons/admin";
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
import { activePricingPlans, getPlanCopy, isStripePlan } from "@/config/pricing";
import { useDataTable } from "@/hooks/use-data-table";
import {
  ColumnDef,
  ColumnPinningState,
  flexRender,
} from "@tanstack/react-table";
import { Plus, TicketPercent, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { CouponFormDialog } from "./CouponFormDialog";
import { type CouponsColumnMeta } from "./Columns";
import { toFormValues, UNRESTRICTED_FILTER, type CouponFormValues } from "./schemas";

// ──────────────────────────────────────────────
//  Constants — mirror the status union of the action
// ──────────────────────────────────────────────

const STATUSES: PromotionCodeStatus[] = [
  "active",
  "disabled",
  "expired",
  "exhausted",
];

interface CouponFilters {
  search: string;
  status: string;
  /** "" = any, UNRESTRICTED_FILTER = codes with no product restriction, else a plan id */
  appliesTo: string;
}

interface DataTableProps {
  columns: ColumnDef<AdminPromotionCodeItem, unknown>[];
  pageSize: number;
  /** Resolved on the server: without Stripe keys there is nothing to list */
  stripeEnabled: boolean;
}

export function CouponsDataTable({
  columns,
  pageSize,
  stripeEnabled,
}: DataTableProps) {
  const t = useTranslations("Coupons");
  const locale = useLocale();

  const [columnPinning] = useState<ColumnPinningState>({
    left: ["code"],
    right: ["actions"],
  });

  // ── create / duplicate dialog ──
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formInitialValues, setFormInitialValues] =
    useState<CouponFormValues | null>(null);
  /** Row awaiting its enable/disable round trip */
  const [togglingId, setTogglingId] = useState<string | null>(null);
  /** How many codes one scan returned, when Stripe holds more than that */
  const [truncatedAt, setTruncatedAt] = useState<number | null>(null);

  const stripePlans = useMemo(
    () => activePricingPlans.filter(isStripePlan),
    []
  );

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
    hasActiveFilters,
    refetch,
  } = useDataTable<AdminPromotionCodeItem, CouponFilters>({
    columns,
    queryKey: ["admin-coupons"],
    pageSize,
    initialFilters: { search: "", status: "", appliesTo: "" },
    columnPinning,
    fetchData: async ({ pageIndex, pageSize, filters }) => {
      if (!stripeEnabled) return { data: [], totalCount: 0 };

      try {
        const result = await getAdminPromotionCodes({
          pageIndex,
          pageSize,
          search: filters.search || undefined,
          status: (filters.status as PromotionCodeStatus) || undefined,
          appliesTo:
            filters.appliesTo === ""
              ? undefined
              : filters.appliesTo === UNRESTRICTED_FILTER
                ? { kind: "unrestricted" }
                : { kind: "plan", planId: filters.appliesTo },
        });

        if (!result.success) {
          toast.error(t("toasts.fetchFailed"), { description: result.error });
          return null;
        }
        if (!result.data) return null;

        setTruncatedAt(result.data.truncated ? result.data.scanned : null);
        return { data: result.data.items, totalCount: result.data.total };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        toast.error(t("toasts.fetchFailed"), { description: message });
        return null;
      }
    },
  });

  const openCreate = useCallback(() => {
    setFormInitialValues(null);
    setDialogOpen(true);
  }, []);

  // Stripe freezes a code once created, so "edit" is really "duplicate and adjust".
  const openDuplicate = useCallback((item: AdminPromotionCodeItem) => {
    setFormInitialValues(toFormValues(item));
    setDialogOpen(true);
  }, []);

  const toggleActive = useCallback(
    async (item: AdminPromotionCodeItem, active: boolean) => {
      setTogglingId(item.id);
      try {
        const result = await setPromotionCodeActive({ id: item.id, active });
        if (!result.success) {
          toast.error(t("toasts.updateFailed"), { description: result.error });
          return;
        }
        toast.success(active ? t("toasts.activated") : t("toasts.deactivated"));
        refetch();
      } finally {
        setTogglingId(null);
      }
    },
    [t, refetch]
  );

  // --- inject callbacks into table meta so columns can call them ---
  const tableMeta: CouponsColumnMeta = useMemo(
    () => ({ onToggle: toggleActive, onDuplicate: openDuplicate, togglingId }),
    [toggleActive, openDuplicate, togglingId]
  );
  table.options.meta = tableMeta;

  const hasData = data.length > 0;

  if (!stripeEnabled) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed p-10 text-center">
        <TicketPercent className="h-6 w-6 text-muted-foreground" />
        <p className="max-w-md text-sm text-muted-foreground">
          {t("stripeDisabled")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <DataTableToolbar
        onRefresh={refetch}
        isRefreshing={isFetching}
        actions={
          <Button size="sm" className="h-8 gap-1.5" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t("createButton")}
          </Button>
        }
      >
        <Input
          placeholder={t("searchPlaceholder")}
          value={filters.search}
          onChange={(event) => updateFilter("search", event.target.value)}
          className="h-8 max-w-xs"
        />
        <Select
          value={filters.status || "all"}
          onValueChange={(value) =>
            updateFilter("status", value === "all" ? "" : value)
          }
        >
          <SelectTrigger className="h-8 w-[150px] text-xs">
            <SelectValue placeholder={t("filters.statusPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filters.allStatuses")}</SelectItem>
            {STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {t(`status.${status}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.appliesTo || "all"}
          onValueChange={(value) =>
            updateFilter("appliesTo", value === "all" ? "" : value)
          }
        >
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <SelectValue placeholder={t("filters.productPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filters.allProducts")}</SelectItem>
            <SelectItem value={UNRESTRICTED_FILTER}>
              {t("filters.unrestricted")}
            </SelectItem>
            {stripePlans.map((plan) => (
              <SelectItem key={plan.id} value={plan.id}>
                {getPlanCopy(plan, locale).name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </DataTableToolbar>

      {truncatedAt !== null && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert className="h-3.5 w-3.5" />
          {t("truncatedWarning", { count: truncatedAt })}
        </p>
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
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <PinnedTableCell key={cell.id} cell={cell} />
                  ))}
                </TableRow>
              ))
            ) : (
              // An empty catalog and an over-filtered one need different words
              <DataTableEmptyState
                colSpan={columns.length}
                message={hasActiveFilters ? t("empty") : t("emptyCreate")}
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

      <CouponFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialValues={formInitialValues}
        onCreated={refetch}
      />
    </div>
  );
}
