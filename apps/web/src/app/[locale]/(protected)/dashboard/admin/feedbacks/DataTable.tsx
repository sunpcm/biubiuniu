/**
 * [INPUT]: Depends on @/actions/feedback/admin for getAllFeedback,
 *          @/hooks/use-data-table for useDataTable hook,
 *          @/components/shared/* for DataTableContainer/DataTableToolbar/PinnedColumn/TablePagination,
 *          @/components/ui for Table/Input/Select,
 *          @/constants/feedback for filter options,
 *          ./Columns for FeedbackColumnMeta,
 *          ./FeedbackDetailSheet for detail slide-over
 * [OUTPUT]: Exports FeedbackDataTable component
 * [POS]: Main data table for admin feedback list, wires up filters/pagination/detail sheet
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { getAllFeedback } from "@/actions/feedback/admin";
import { DataTableContainer, DataTableEmptyState } from "@/components/shared/data-table-container";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { PinnedTableCell, PinnedTableHead } from "@/components/shared/pinned-column";
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
import {
  FEEDBACK_PRIORITIES,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  isFeedbackPriority,
  isFeedbackStatus,
  isFeedbackType,
  type FeedbackPriority,
  type FeedbackStatus,
  type FeedbackType,
} from "@/constants/feedback";
import { useDataTable } from "@/hooks/use-data-table";
import { FeedbackWithUser } from "@/types/admin/feedback";
import { ColumnDef, ColumnPinningState, flexRender } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { FeedbackColumnMeta } from "./Columns";
import { FeedbackDetailSheet } from "./FeedbackDetailSheet";

// ──────────────────────────────────────────────
//  Types
// ──────────────────────────────────────────────

interface DataTableProps {
  columns: ColumnDef<FeedbackWithUser, unknown>[];
  pageSize: number;
}

interface FeedbackFilters {
  search: string;
  status: FeedbackStatus | "";
  type: FeedbackType | "";
  priority: FeedbackPriority | "";
}

type FeedbackSelectKey = Exclude<keyof FeedbackFilters, "search">;

// ──────────────────────────────────────────────
//  Component
// ──────────────────────────────────────────────

export function FeedbackDataTable({ columns, pageSize }: DataTableProps) {
  const [columnPinning] = useState<ColumnPinningState>({
    left: ["user"],
  });

  // --- detail sheet state ---
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const openDetail = useCallback((feedbackId: string) => {
    setSelectedFeedbackId(feedbackId);
    setSheetOpen(true);
  }, []);

  // --- data table ---
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
  } = useDataTable<FeedbackWithUser, FeedbackFilters>({
    columns,
    queryKey: ["admin-feedbacks"],
    pageSize,
    initialFilters: {
      search: "",
      status: "",
      type: "",
      priority: "",
    },
    columnPinning,
    fetchData: async ({ pageIndex, pageSize, filters }) => {
      try {
        const result = await getAllFeedback({
          pageIndex,
          pageSize,
          searchQuery: filters.search || undefined,
          filterStatus: filters.status || undefined,
          filterType: filters.type || undefined,
          filterPriority: filters.priority || undefined,
        });

        if (!result.success) {
          toast.error("Failed to fetch feedbacks", {
            description: result.error,
          });
          return null;
        }

        if (result.data) {
          return {
            data: result.data.feedbacks,
            totalCount: result.data.totalCount,
          };
        }

        return null;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        toast.error("Failed to fetch feedbacks", { description: message });
        return null;
      }
    },
  });

  // --- inject callbacks into table meta so columns can call them ---
  const tableMeta: FeedbackColumnMeta = useMemo(
    () => ({
      onViewDetail: openDetail,
      onRefetch: refetch,
    }),
    [openDetail, refetch],
  );

  // Patch meta onto the table instance — tanstack supports this via options
  table.options.meta = tableMeta;

  const hasData = data.length > 0;

  const updateSelectFilter = useCallback(
    (key: FeedbackSelectKey, value: string) => {
      if (value === "all") {
        updateFilter(key, "");
        return;
      }

      switch (key) {
        case "status":
          if (isFeedbackStatus(value)) updateFilter("status", value);
          break;
        case "type":
          if (isFeedbackType(value)) updateFilter("type", value);
          break;
        case "priority":
          if (isFeedbackPriority(value)) updateFilter("priority", value);
          break;
      }
    },
    [updateFilter],
  );

  // --- filter select configs ---
  const filterSelects = useMemo(
    () => [
      {
        key: "status" as const,
        label: "All Statuses",
        placeholder: "Status",
        width: "w-[160px]",
        options: FEEDBACK_STATUSES,
        formatLabel: (v: string) => v.replace(/_/g, " "),
      },
      {
        key: "type" as const,
        label: "All Types",
        placeholder: "Type",
        width: "w-[160px]",
        options: FEEDBACK_TYPES,
        formatLabel: (v: string) => v.replace(/_/g, " "),
      },
      {
        key: "priority" as const,
        label: "All Priorities",
        placeholder: "Priority",
        width: "w-[140px]",
        options: FEEDBACK_PRIORITIES,
        formatLabel: (v: string) => v,
      },
    ],
    [],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <DataTableToolbar onRefresh={refetch} isRefreshing={isFetching}>
        <Input
          placeholder="Search by title, description, email..."
          value={filters.search}
          onChange={(event) => updateFilter("search", event.target.value)}
          className="h-8 max-w-sm"
        />
        {filterSelects.map((select) => (
          <Select
            key={select.key}
            value={filters[select.key] || "all"}
            onValueChange={(value) => updateSelectFilter(select.key, value)}
          >
            <SelectTrigger className={`${select.width} h-8 text-xs`}>
              <SelectValue placeholder={select.placeholder} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{select.label}</SelectItem>
              {select.options.map((option) => (
                <SelectItem key={option} value={option} className="text-xs capitalize">
                  {select.formatLabel(option)}
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
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </PinnedTableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
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

      <FeedbackDetailSheet
        feedbackId={selectedFeedbackId}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onUpdate={refetch}
      />
    </div>
  );
}
