"use client";

/**
 * [INPUT]: Depends on components/ui/table's TableRow / TableCell, the sibling
 *          table-skeleton's TableSkeleton, styles/globals.css' @keyframes shimmer
 *          (the translateX light bar)
 * [OUTPUT]: Exports DataTableContainer / getTableLoadingState / DataTableEmptyState
 * [POS]: The container layer of the components/shared table kit: owns the three
 *        states "first-paint skeleton / transition progress bar + dimmed rows /
 *        content". Headers, sorting, pagination and pinned columns are sibling
 *        atoms; this file only does the shell and the loading semantics. Both
 *        fetch families (use-data-table and use-paged-query) share this one container
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { cn } from "@/lib/utils";
import { ReactNode } from "react";
import { TableSkeleton } from "./table-skeleton";
import { TableCell, TableRow } from "@/components/ui/table";

// ============================================
// Types
// ============================================

interface DataTableContainerProps {
  /**
   * Child element (the Table)
   */
  children: ReactNode;
  /**
   * Whether this is the initial load (shows skeleton)
   */
  isInitialLoading: boolean;
  /**
   * Page / filter transition (feed useDataTable / usePagedQuery's
   * isPlaceholderData, never the raw isFetching): only when the rows on screen
   * still belong to the previous page or filter does the table dim and show
   * the progress bar. A same-key background refetch (tab remount, polling,
   * manual refresh) stays silent; that feedback belongs to the toolbar button
   */
  isFetching?: boolean;
  /**
   * Whether there is data to display
   */
  hasData: boolean;
  /**
   * Number of columns (used by skeleton)
   */
  columnCount: number;
  /**
   * Number of skeleton rows
   */
  skeletonRowCount?: number;
  /**
   * Max height of the table body, e.g. "calc(100vh - 280px)".
   * Ignored when fillAvailableSpace is true.
   */
  maxHeight?: string;
  /**
   * Container class name
   */
  className?: string;
  /**
   * Table wrapper class name
   */
  tableClassName?: string;
  /**
   * Show top shimmer progress bar during fetching
   */
  showProgressBar?: boolean;
  /**
   * Opacity of content while fetching
   */
  fetchingOpacity?: number;
  /**
   * When true, the table stretches to fill the remaining height of its parent
   * and scrolls internally instead of using a fixed maxHeight.
   */
  fillAvailableSpace?: boolean;
}

interface LoadingStateOptions {
  isLoading: boolean;
  dataLength: number;
}

interface LoadingState {
  isInitialLoading: boolean;
  isFetching: boolean;
  hasData: boolean;
}

interface TableEmptyStateProps {
  colSpan: number;
  message?: string;
  className?: string;
}

// ============================================
// Component: DataTableContainer
// ============================================

/**
 * Unified data table container.
 *
 * Provides a standardized loading experience:
 * 1. Initial load: shows a skeleton table
 * 2. Subsequent refresh: keeps data visible, lowers opacity, and shows a shimmer progress bar
 *
 * When `fillAvailableSpace` is true, the container uses flex layout to occupy the
 * remaining vertical space of its parent while keeping the table body scrollable.
 */
export function DataTableContainer({
  children,
  isInitialLoading,
  isFetching = false,
  hasData,
  columnCount,
  skeletonRowCount = 5,
  maxHeight = "calc(100vh - 170px)",
  className,
  tableClassName,
  showProgressBar = true,
  fetchingOpacity = 0.5,
  fillAvailableSpace = false,
}: DataTableContainerProps) {
  if (isInitialLoading) {
    return (
      <div
        className={cn(
          fillAvailableSpace && "flex flex-col flex-1 min-h-0",
          className
        )}
      >
        <TableSkeleton columnCount={columnCount} rowCount={skeletonRowCount} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border",
        fillAvailableSpace && "flex flex-col flex-1 min-h-0",
        className
      )}
    >
      {showProgressBar && isFetching && hasData && (
        <div className="absolute top-0 left-0 right-0 z-30">
          <div className="h-0.5 bg-primary/20 overflow-hidden rounded-t-md">
            <div
              className="h-full bg-primary animate-[shimmer_1.5s_infinite] w-1/3"
              style={{
                background:
                  "linear-gradient(90deg, transparent, var(--primary), transparent)",
                animation: "shimmer 1.5s infinite",
              }}
            />
          </div>
        </div>
      )}

      <div
        className={cn(
          "overflow-auto [&_[data-slot=table-container]]:overflow-visible [&_[data-slot=table-header]]:bg-background [&_[data-slot=table-header]]:sticky [&_[data-slot=table-header]]:top-0 [&_[data-slot=table-header]]:z-30",
          fillAvailableSpace
            ? "absolute inset-0"
            : "flex-1 min-h-0",
          tableClassName
        )}
        style={
          !fillAvailableSpace && maxHeight ? { maxHeight } : undefined
        }
      >
        <div
          className={cn(
            "transition-opacity duration-200",
            isFetching && hasData && "pointer-events-none"
          )}
          style={{
            opacity: isFetching && hasData ? fetchingOpacity : 1,
          }}
          aria-busy={isFetching && hasData}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Helper: getTableLoadingState
// ============================================

/**
 * Derive standardized table loading flags from a single `isLoading` signal.
 */
export function getTableLoadingState({
  isLoading,
  dataLength,
}: LoadingStateOptions): LoadingState {
  const hasData = dataLength > 0;
  const isInitialLoading = isLoading && !hasData;
  const isFetching = isLoading && hasData;

  return { isInitialLoading, isFetching, hasData };
}

// ============================================
// Component: DataTableEmptyState
// ============================================

/**
 * Unified empty state for tables.
 */
export function DataTableEmptyState({
  colSpan,
  message = "No results found.",
  className,
}: TableEmptyStateProps) {
  return (
    <TableRow>
      <TableCell
        colSpan={colSpan}
        style={{ textAlign: "center" }}
        className={cn("h-24 text-muted-foreground", className)}
      >
        {message}
      </TableCell>
    </TableRow>
  );
}
