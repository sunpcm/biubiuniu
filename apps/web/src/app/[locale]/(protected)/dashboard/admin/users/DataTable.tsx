/**
 * [INPUT]: Depends on @/actions/users/admin for getUsers / GetUsersResult,
 *          @/hooks/use-data-table for useDataTable (server-side pagination,
 *          search, filters and sorting via React Query), @/components/shared's
 *          {data-table-container, data-table-toolbar, pinned-column,
 *          table-elements} for the table chrome, @/components/ui's Calendar /
 *          Popover / Select / Input for the filter controls, dayjs and
 *          react-day-picker's DateRange for the signup-date range,
 *          ./SignupBlocklistSheet for the toolbar action slot,
 *          ./use-user-row-action for ADMIN_USERS_QUERY_KEY (the cache key shared
 *          with the row actions' optimistic updates / silent refresh)
 * [OUTPUT]: Exports the DataTable component (the admin user table: search +
 *           ban state + role + signup-date range (presets or a two-month range
 *           picker; local calendar days become ISO instants for the server),
 *           pagination, server-side sorting (a sort change returns to page 1),
 *           user / actions pinned on both sides on desktop)
 * [POS]: The table shell of admin/users, consumed by page.tsx; renders the
 *        column definitions from Columns.tsx and owns fetching, toolbar and
 *        pagination, while row-action dialogs live in the columns
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { getUsers, GetUsersResult } from "@/actions/users/admin";
import {
  DataTableContainer,
  DataTableEmptyState,
  getTableLoadingState,
} from "@/components/shared/data-table-container";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import {
  PinnedTableCell,
  PinnedTableHead,
} from "@/components/shared/pinned-column";
import { TablePagination } from "@/components/shared/table-elements";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import { useDataTable } from "@/hooks/use-data-table";
import {
  ColumnDef,
  ColumnPinningState,
  flexRender,
} from "@tanstack/react-table";
import dayjs from "dayjs";
import { CalendarIcon } from "lucide-react";
import { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { SignupBlocklistSheet } from "./SignupBlocklistSheet";
import { ADMIN_USERS_QUERY_KEY } from "./use-user-row-action";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  pageSize: number;
}

type UserFilters = {
  search: string;
  /** "all" | "banned" | "active" (Radix Select rejects an empty-string value, hence the "all" sentinel) */
  banned: string;
  /** "all" | user / admin / superadmin */
  role: string;
  /**
   * Signup-date range as ISO instants ("" = unbounded). The range picker works
   * in local calendar days: 00:00:00 of the first day to 23:59:59 of the last,
   * converted to ISO (a UTC instant) so the server's timestamptz compares directly.
   */
  createdFrom: string;
  createdTo: string;
};

/* -------------------------------------------------------------------------- */
/*  Signup-date range filter: presets on the left, two-month range picker on   */
/*  the right. Both produce whole local days.                                  */
/* -------------------------------------------------------------------------- */

const SIGNUP_RANGE_PRESETS: { key: string; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
];

/** Preset -> local start / end instants (first day 00:00:00, last day 23:59:59) */
function presetToRange(key: string): { from: Date; to: Date } {
  const now = dayjs();
  switch (key) {
    case "today":
      return { from: now.startOf("day").toDate(), to: now.endOf("day").toDate() };
    case "yesterday": {
      const y = now.subtract(1, "day");
      return { from: y.startOf("day").toDate(), to: y.endOf("day").toDate() };
    }
    case "7d":
      return {
        from: now.subtract(6, "day").startOf("day").toDate(),
        to: now.endOf("day").toDate(),
      };
    case "30d":
      return {
        from: now.subtract(29, "day").startOf("day").toDate(),
        to: now.endOf("day").toDate(),
      };
    case "90d":
      return {
        from: now.subtract(89, "day").startOf("day").toDate(),
        to: now.endOf("day").toDate(),
      };
    default:
      return { from: now.toDate(), to: now.toDate() };
  }
}

function SignupRangeFilter({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const activePreset = SIGNUP_RANGE_PRESETS.find((p) => {
    const r = presetToRange(p.key);
    return (
      from &&
      to &&
      dayjs(from).isSame(dayjs(r.from), "day") &&
      dayjs(to).isSame(dayjs(r.to), "day")
    );
  });

  const selected: DateRange | undefined =
    from || to
      ? {
          from: from ? new Date(from) : undefined,
          to: to ? new Date(to) : undefined,
        }
      : undefined;

  /** Calendar days -> whole-day range: first second of the start day, last second of the end day */
  const handleSelect = (range: DateRange | undefined) => {
    onChange(
      range?.from ? dayjs(range.from).startOf("day").toISOString() : "",
      range?.to ? dayjs(range.to).endOf("day").toISOString() : ""
    );
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5">
          <CalendarIcon className="h-3.5 w-3.5" />
          {from || to ? (
            <span className="tabular-nums">
              {from ? dayjs(from).format("YYYY-MM-DD") : "…"}
              {" → "}
              {to ? dayjs(to).format("YYYY-MM-DD") : "…"}
            </span>
          ) : (
            "Signup date"
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-auto p-0">
        <div className="flex flex-col gap-1 border-r p-3">
          {SIGNUP_RANGE_PRESETS.map((p) => (
            <Button
              key={p.key}
              variant={activePreset?.key === p.key ? "secondary" : "ghost"}
              size="sm"
              className="h-7 justify-start px-2 text-xs"
              onClick={() => {
                const r = presetToRange(p.key);
                onChange(r.from.toISOString(), r.to.toISOString());
              }}
            >
              {p.label}
            </Button>
          ))}
          {(from || to) && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-7 justify-start px-2 text-xs text-muted-foreground"
              onClick={() => onChange("", "")}
            >
              Clear
            </Button>
          )}
        </div>
        <Calendar
          mode="range"
          numberOfMonths={2}
          selected={selected}
          onSelect={handleSelect}
          defaultMonth={selected?.from}
        />
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */
/*  Table                                                                     */
/* -------------------------------------------------------------------------- */

export function DataTable<TData, TValue>({
  columns,
  pageSize,
}: DataTableProps<TData, TValue>) {
  // Desktop layout only: useDataTable drops every pinned column below 768px
  // (a pinned column eats horizontal space on narrow screens)
  const columnPinning: ColumnPinningState = {
    left: ["user"],
    right: ["actions"],
  };

  const {
    table,
    isLoading,
    isInitialLoading,
    isFetching,
    isPlaceholderData,
    pagination,
    totalCount,
    pageCount,
    filters,
    updateFilter,
    setFilters,
    setPagination,
    refetch,
  } = useDataTable<TData, UserFilters>({
    columns,
    queryKey: [...ADMIN_USERS_QUERY_KEY],
    pageSize,
    initialFilters: {
      search: "",
      banned: "all",
      role: "all",
      createdFrom: "",
      createdTo: "",
    },
    columnPinning,
    manualSorting: true,
    fetchData: async ({ pageIndex, pageSize, filters, sorting }) => {
      try {
        const result: GetUsersResult = await getUsers({
          pageIndex,
          pageSize,
          filter: filters.search,
          banned:
            filters.banned === "all" ? undefined : filters.banned === "banned",
          role:
            filters.role === "all"
              ? undefined
              : (filters.role as "user" | "admin" | "superadmin"),
          createdFrom: filters.createdFrom || undefined,
          createdTo: filters.createdTo || undefined,
          sort: sorting[0]
            ? { id: sorting[0].id, desc: sorting[0].desc }
            : undefined,
        });

        if (!result.success) {
          toast.error("Failed to fetch data", {
            description: result.error,
          });
          return null;
        }

        if (result.data) {
          return {
            data: result.data.users as TData[],
            totalCount: result.data.totalCount || 0,
          };
        }

        return null;
      } catch (error: any) {
        toast.error("Failed to fetch data", {
          description: error.message,
        });
        return null;
      }
    },
  });

  const { hasData } = getTableLoadingState({
    isLoading,
    dataLength: table.getRowModel().rows.length,
  });

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <DataTableToolbar
        onRefresh={refetch}
        isRefreshing={isFetching}
        actions={<SignupBlocklistSheet />}
      >
        {/* Four filters on one row without crowding: a narrower search, small Select / Popover triggers */}
        <Input
          placeholder="Search by Email, Name..."
          value={filters.search}
          onChange={(event) => updateFilter("search", event.target.value)}
          className="h-8 w-40"
        />
        <Select
          value={filters.banned}
          onValueChange={(v) => updateFilter("banned", v)}
        >
          <SelectTrigger size="sm" className="w-28">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="banned">Banned</SelectItem>
            <SelectItem value="active">Active</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.role}
          onValueChange={(v) => updateFilter("role", v)}
        >
          <SelectTrigger size="sm" className="w-32">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="user">User</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="superadmin">Superadmin</SelectItem>
          </SelectContent>
        </Select>
        <SignupRangeFilter
          from={filters.createdFrom}
          to={filters.createdTo}
          onChange={(from, to) => {
            // Two fields change together, so bypass updateFilter (one key at a time) and reset to page 1 ourselves
            setFilters((prev) => ({ ...prev, createdFrom: from, createdTo: to }));
            setPagination((prev) => ({ ...prev, pageIndex: 0 }));
          }}
        />
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
    </div>
  );
}
