"use client";

/**
 * [INPUT]: Depends on @tanstack/react-table's useReactTable, @tanstack/react-query's
 *          useQuery + keepPreviousData, use-debounce, ./use-mobile's useIsMobile
 *          (pinned columns are dropped on mobile inside the engine)
 * [OUTPUT]: Exports the useDataTable hook and the ColumnDef alias: pagination /
 *           debounced filters / sorting (optional manualSorting = server side) /
 *           loading state / optional polling (refetchInterval). Three loading
 *           signals: isInitialLoading (first-paint skeleton), isPlaceholderData
 *           (page or filter transition: the screen still shows the previous key's
 *           rows; this is what DataTableContainer's isFetching wants) and the raw
 *           isFetching (feeds the toolbar refresh spinner only, so a same-key
 *           background refetch - tab remount, polling, manual refresh - stays silent).
 *           columnPinning applies on desktop only; below 768px nothing is pinned
 * [POS]: The data-table engine of hooks/, consumed by every dashboard table
 *        (admin users/orders/credits/feedbacks/coupons, user credit-history and
 *        my-orders, cms PostDataTable); the sibling use-paged-query serves lists
 *        that only page
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import {
  ColumnDef as TanstackColumnDef,
  ColumnPinningState,
  getCoreRowModel,
  getSortedRowModel,
  PaginationState,
  SortingState,
  useReactTable,
  VisibilityState,
} from "@tanstack/react-table";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useDebounce } from "use-debounce";
import { useIsMobile } from "./use-mobile";

export type ColumnDef<TData, TValue = unknown> = TanstackColumnDef<
  TData,
  TValue
>;

// ============================================
// Types
// ============================================

export interface UseDataTableOptions<
  TData,
  TFilters extends Record<string, any>
> {
  /** Table columns */
  columns: ColumnDef<TData, any>[];
  /** React Query key (base) */
  queryKey: string[];
  /** Page size */
  pageSize: number;
  /** Initial filter values */
  initialFilters?: TFilters;
  /** Debounce delay for filters (ms) */
  debounceDelay?: number;
  /**
   * Column pinning config. Desktop only: on mobile the engine forces "nothing
   * pinned", so callers declare the desktop layout and nothing else.
   */
  columnPinning?: ColumnPinningState;
  /** Enable column visibility state */
  enableColumnVisibility?: boolean;
  /**
   * Server-side sorting: sorting state is passed to fetchData and included in
   * the query key; client-side row-model sorting is disabled. Use when
   * pagination is server-side (client sorting would only sort the current page).
   */
  manualSorting?: boolean;
  /** Fetch data function */
  fetchData: (params: {
    pageIndex: number;
    pageSize: number;
    filters: TFilters;
    sorting: SortingState;
  }) => Promise<{ data: TData[]; totalCount: number } | null>;
  /**
   * Poll interval in ms, or a function of the latest result for conditional
   * polling (e.g. keep polling while any row is still in flight).
   */
  refetchInterval?:
    | number
    | false
    | ((
        data: { data: TData[]; totalCount: number } | undefined
      ) => number | false);
}

export interface UseDataTableReturn<TData, TFilters> {
  table: ReturnType<typeof useReactTable<TData>>;
  data: TData[];
  isLoading: boolean;
  isInitialLoading: boolean;
  isFetching: boolean;
  /**
   * Page / filter transition: the query key changed and the screen still shows
   * the previous key's rows. This is the signal for DataTableContainer's
   * isFetching. A same-key background refetch (tab remount, polling, manual
   * refresh) does not set it, so the table stays silent.
   */
  isPlaceholderData: boolean;
  isError: boolean;
  error: Error | null;
  pagination: PaginationState;
  setPagination: React.Dispatch<React.SetStateAction<PaginationState>>;
  sorting: SortingState;
  setSorting: React.Dispatch<React.SetStateAction<SortingState>>;
  filters: TFilters;
  setFilters: React.Dispatch<React.SetStateAction<TFilters>>;
  updateFilter: <K extends keyof TFilters>(key: K, value: TFilters[K]) => void;
  resetFilters: () => void;
  refetch: () => void;
  pageCount: number;
  totalCount: number;
  hasActiveFilters: boolean;
}

// ============================================
// Hook: useDataTable
// ============================================

/**
 * Generic data table hook powered by React Query.
 *
 * Handles client-side data fetching, pagination, sorting, debounced filters,
 * loading states, caching, and refresh.
 */
export function useDataTable<TData, TFilters extends Record<string, any>>({
  columns,
  queryKey,
  pageSize,
  initialFilters,
  debounceDelay = 500,
  columnPinning,
  enableColumnVisibility = false,
  manualSorting = false,
  fetchData,
  refetchInterval,
}: UseDataTableOptions<TData, TFilters>): UseDataTableReturn<TData, TFilters> {
  const [sorting, setSortingState] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  });
  const [filters, setFilters] = useState<TFilters>(
    initialFilters ?? ({} as TFilters)
  );
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const [debouncedFilters] = useDebounce(filters, debounceDelay);

  // Pinned columns eat horizontal space on narrow screens and make scrolling
  // harder to read, so mobile never pins. The check lives in the engine: a
  // useIsMobile in every table is N copies of one rule, and copies drift
  // (see TABLE_DESIGN_STANDARDS.md section 6).
  const isMobile = useIsMobile();
  const effectiveColumnPinning: ColumnPinningState = isMobile
    ? { left: [], right: [] }
    : (columnPinning ?? { left: [], right: [] });

  const hasActiveFilters = useMemo(() => {
    if (!initialFilters) return false;
    return Object.keys(initialFilters).some(
      (key) => filters[key] !== initialFilters[key]
    );
  }, [filters, initialFilters]);

  const updateFilter = useCallback(
    <K extends keyof TFilters>(key: K, value: TFilters[K]) => {
      setFilters((prev) => ({ ...prev, [key]: value }));
      setPagination((prev) => ({ ...prev, pageIndex: 0 }));
    },
    []
  );

  const resetFilters = useCallback(() => {
    setFilters(initialFilters ?? ({} as TFilters));
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [initialFilters]);

  // Server-side sorting changes must restart from page 1 — the current page
  // index is meaningless once the whole result set is re-ordered.
  const setSorting: React.Dispatch<React.SetStateAction<SortingState>> =
    useCallback(
      (updater) => {
        setSortingState(updater);
        if (manualSorting) {
          setPagination((prev) => ({ ...prev, pageIndex: 0 }));
        }
      },
      [manualSorting]
    );

  const {
    data: queryResult,
    isLoading,
    isFetching,
    isPlaceholderData,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: [
      ...queryKey,
      String(pagination.pageIndex),
      String(pagination.pageSize),
      debouncedFilters,
      ...(manualSorting ? [sorting] : []),
    ],
    queryFn: async () => {
      const result = await fetchData({
        pageIndex: pagination.pageIndex,
        pageSize: pagination.pageSize,
        filters: debouncedFilters,
        sorting,
      });
      return result ?? { data: [], totalCount: 0 };
    },
    placeholderData: keepPreviousData,
    refetchInterval:
      typeof refetchInterval === "function"
        ? (query) => refetchInterval(query.state.data)
        : refetchInterval,
  });

  const data = queryResult?.data ?? [];
  const totalCount = queryResult?.totalCount ?? 0;
  const pageCount = Math.ceil(totalCount / pagination.pageSize);

  const isInitialLoading = isLoading && data.length === 0;

  const table = useReactTable({
    data,
    columns: columns as ColumnDef<TData, unknown>[],
    pageCount,
    state: {
      sorting,
      pagination,
      columnPinning: effectiveColumnPinning,
      columnVisibility,
    },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    onColumnVisibilityChange: enableColumnVisibility
      ? setColumnVisibility
      : undefined,
    getCoreRowModel: getCoreRowModel(),
    ...(manualSorting ? {} : { getSortedRowModel: getSortedRowModel() }),
    manualPagination: true,
    manualFiltering: true,
    manualSorting,
    enableColumnPinning: !!columnPinning,
    debugTable: process.env.NODE_ENV === "development",
  });

  return {
    table,
    data,
    isLoading,
    isInitialLoading,
    isFetching,
    isPlaceholderData,
    isError,
    error,
    pagination,
    setPagination,
    sorting,
    setSorting,
    filters,
    setFilters,
    updateFilter,
    resetFilters,
    refetch,
    pageCount,
    totalCount,
    hasActiveFilters,
  };
}
