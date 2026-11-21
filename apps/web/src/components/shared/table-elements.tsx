"use client";

/**
 * [INPUT]: Depends on @/components/ui's Button and Select family (prev/next,
 *          first/last, page-size and page-number selects), @/lib/utils' cn,
 *          lucide-react's four Chevron icons; deliberately not on next-intl
 * [OUTPUT]: Exports TablePagination (offset pagination bar: page numbers in
 *           ellipsis / simple mode, optional first/last, page size, three info
 *           text modes), the TablePaginationNavLabels type and
 *           PINNED_COLUMN_STYLES (z-index / shadows / background for pinned columns)
 * [POS]: The pagination bar and pinned-column constants of the components/shared
 *        table kit, consumed by the admin tables (use-data-table family) and the
 *        user-facing billing / team / admin user-detail tables (use-paged-query
 *        family). Siblings: container + loading states in data-table-container,
 *        filters in data-table-toolbar, sort headers in sortable-header, skeleton
 *        in table-skeleton, pinned-column reads PINNED_COLUMN_STYLES from here.
 *        Built-in strings are the English admin wording; user-facing pages pass
 *        translations through info (the whole left text) and navLabels
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { ReactNode } from "react";

// ============================================
// Component: TablePagination
// ============================================

/** title / aria-label of the nav buttons: user-facing pages pass translations, admin omits it and gets English */
export interface TablePaginationNavLabels {
  previous?: string;
  next?: string;
  first?: string;
  last?: string;
}

interface TablePaginationProps {
  /** Current page index (0-based) */
  pageIndex: number;
  /** Total number of pages */
  pageCount: number;
  /** Total number of items */
  totalItems?: number;
  /** Loading state disables controls */
  isLoading?: boolean;
  /** Previous page callback */
  onPrevious: () => void;
  /** Next page callback */
  onNext: () => void;
  className?: string;
  /** Current page size (provided to show page size selector) */
  pageSize?: number;
  /** Page size options */
  pageSizeOptions?: number[];
  /** Page size change callback */
  onPageSizeChange?: (pageSize: number) => void;
  /** Page change callback (provided to show page number selector) */
  onPageChange?: (pageIndex: number) => void;
  /** Show first/last page buttons */
  showFirstLast?: boolean;
  /** Page number display mode */
  pageNumberMode?: "ellipsis" | "simple";
  /** Info text mode */
  infoMode?: "range" | "page" | "simple";
  /**
   * Override the left-hand info text. The built-in text is English (admin
   * wording); a user-facing page passes an already translated string, so the
   * component never needs next-intl.
   */
  info?: ReactNode;
  /** Override the nav buttons' title / aria-label (same idea as info) */
  navLabels?: TablePaginationNavLabels;
}

const DEFAULT_NAV_LABELS: Required<TablePaginationNavLabels> = {
  previous: "Previous page",
  next: "Next page",
  first: "First page",
  last: "Last page",
};

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function generatePageNumbers(
  currentPage: number,
  totalPages: number,
  siblingCount: number = 1
): (number | "ellipsis")[] {
  if (totalPages <= 0) return [];
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages: (number | "ellipsis")[] = [];
  pages.push(1);

  // Compute the range of pages around currentPage
  const startPage = Math.max(2, currentPage - siblingCount);
  const endPage = Math.min(totalPages - 1, currentPage + siblingCount);

  // Expand start/end so we always show at least 5 inner numbers
  const adjustedStart = Math.min(startPage, totalPages - 4);
  const adjustedEnd = Math.max(endPage, 5);
  const finalStart = Math.max(2, adjustedStart);
  const finalEnd = Math.min(totalPages - 1, adjustedEnd);

  // Leading ellipsis only if there's a gap between page 1 and finalStart
  if (finalStart > 2) {
    pages.push("ellipsis");
  }

  for (let i = finalStart; i <= finalEnd; i++) {
    pages.push(i);
  }

  // Trailing ellipsis only if there's a gap between finalEnd and last page
  if (finalEnd < totalPages - 1) {
    pages.push("ellipsis");
  }

  pages.push(totalPages);

  return pages;
}

/**
 * Unified table pagination component.
 *
 * Supports previous/next, page numbers with ellipsis, page size selector,
 * first/last buttons, and multiple info display modes.
 */
export function TablePagination({
  pageIndex,
  pageCount,
  totalItems = 0,
  isLoading = false,
  onPrevious,
  onNext,
  className,
  pageSize,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  onPageSizeChange,
  onPageChange,
  showFirstLast = false,
  pageNumberMode = "ellipsis",
  infoMode = "page",
  info,
  navLabels,
}: TablePaginationProps) {
  const labels = { ...DEFAULT_NAV_LABELS, ...navLabels };

  const currentPage = pageIndex + 1;
  const canPrevious = pageIndex > 0;
  const canNext = pageIndex < pageCount - 1;

  const getRangeText = () => {
    if (totalItems === 0) return "Showing 0 items";
    const start = pageIndex * (pageSize || 10) + 1;
    const end = Math.min((pageIndex + 1) * (pageSize || 10), totalItems);
    return `Showing ${start.toLocaleString()}-${end.toLocaleString()} of ${totalItems.toLocaleString()} items`;
  };

  const pageOptions = Array.from(
    { length: Math.max(0, pageCount) },
    (_, i) => i
  );

  const pageNumbers = generatePageNumbers(currentPage, pageCount);

  const handleFirstPage = () => {
    if (onPageChange) {
      onPageChange(0);
    }
  };

  const handleLastPage = () => {
    if (onPageChange) {
      onPageChange(pageCount - 1);
    }
  };

  const renderInfo = () => {
    // A caller-provided translation replaces the whole text; infoMode only
    // shapes the three built-in English variants
    if (info !== undefined) {
      return (
        <div className="text-xs text-muted-foreground whitespace-nowrap">
          {info}
        </div>
      );
    }

    switch (infoMode) {
      case "range":
        return (
          <div className="text-xs text-muted-foreground whitespace-nowrap">
            {getRangeText()}
          </div>
        );
      case "page":
        return (
          <div className="text-xs text-muted-foreground whitespace-nowrap">
            {pageCount > 0 ? (
              <>
                Page <span className="font-medium">{currentPage}</span> of{" "}
                <span className="font-medium">{pageCount}</span>
                <span className="mx-1.5 text-border">·</span>
              </>
            ) : null}
            <span className="font-medium">{totalItems.toLocaleString()}</span>{" "}
            items
          </div>
        );
      case "simple":
      default:
        return (
          <div className="text-xs text-muted-foreground whitespace-nowrap">
            <span className="font-medium">{totalItems.toLocaleString()}</span>{" "}
            items
          </div>
        );
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2",
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:justify-start">
        {renderInfo()}

        {pageSize !== undefined && onPageSizeChange && (
          <div className="flex items-center gap-3">
            <div className="hidden h-4 w-px bg-border sm:block" />
            <div className="flex items-center gap-1.5">
              <Select
                value={String(pageSize)}
                onValueChange={(value) => onPageSizeChange(Number(value))}
                disabled={isLoading}
              >
                <SelectTrigger className="w-[64px] text-xs px-2" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pageSizeOptions.map((option) => (
                    <SelectItem
                      key={option}
                      value={String(option)}
                      className="text-xs"
                    >
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">/ page</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:justify-end">
        {onPageChange && pageCount > 1 && pageNumberMode === "ellipsis" && (
          <div className="flex items-center gap-1">
            {pageNumbers.map((pageNum, idx) =>
              pageNum === "ellipsis" ? (
                <span
                  key={`ellipsis-${idx}`}
                  className="px-1.5 text-xs text-muted-foreground select-none"
                >
                  …
                </span>
              ) : (
                <button
                  key={pageNum}
                  onClick={() => onPageChange(pageNum - 1)}
                  disabled={isLoading}
                  className={cn(
                    "min-w-[28px] h-7 px-1.5 rounded-md text-xs font-medium transition-colors",
                    pageNum === currentPage
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  )}
                >
                  {pageNum}
                </button>
              )
            )}
          </div>
        )}

        {onPageChange && pageCount > 1 && pageNumberMode === "simple" && (
          <Select
            value={String(pageIndex)}
            onValueChange={(value) => onPageChange(Number(value))}
            disabled={isLoading}
          >
            <SelectTrigger className="text-xs px-2" size="sm">
              <SelectValue placeholder={`${currentPage} / ${pageCount}`} />
            </SelectTrigger>
            <SelectContent className="max-h-[240px]">
              {pageOptions.map((idx) => (
                <SelectItem key={idx} value={String(idx)} className="text-xs">
                  {idx + 1} / {pageCount}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="flex items-center">
          {showFirstLast && onPageChange && pageCount > 2 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleFirstPage}
              disabled={!canPrevious || isLoading}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              title={labels.first}
              aria-label={labels.first}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={onPrevious}
            disabled={!canPrevious || isLoading}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            title={labels.previous}
            aria-label={labels.previous}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={onNext}
            disabled={!canNext || isLoading}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            title={labels.next}
            aria-label={labels.next}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          {showFirstLast && onPageChange && pageCount > 2 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLastPage}
              disabled={!canNext || isLoading}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              title={labels.last}
              aria-label={labels.last}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Constants: pinned column styles
// ============================================

export const PINNED_COLUMN_STYLES = {
  headerZIndex: 40,
  cellZIndex: 20,
  leftShadow: "2px 0 4px -2px rgba(0, 0, 0, 0.1)",
  rightShadow: "-2px 0 4px -2px rgba(0, 0, 0, 0.1)",
  backgroundColor: "var(--background)",
} as const;

