"use client";

/**
 * [INPUT]: Depends on @tanstack/react-query's useQuery + keepPreviousData
 * [OUTPUT]: Exports the usePagedQuery hook and the PagedResult type: page-index
 *           state + a paged query + the same three loading signals as
 *           useDataTable (isInitialLoading / isPlaceholderData / isFetching)
 * [POS]: The lightweight paging engine of hooks/, for tables that only page and
 *        do not want TanStack Table (billing history, team activity, the admin
 *        user-detail history tabs); tables that need column defs, debounced
 *        filters, sorting or pinned columns use the sibling use-data-table
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

// ============================================
// Types
// ============================================

export interface PagedResult<TItem> {
  items: TItem[];
  total: number;
}

export interface UsePagedQueryOptions<TItem> {
  /**
   * Stable query-key prefix (without the page index): the hook appends
   * pageIndex itself. Filters must go in here, otherwise changing them
   * refetches nothing.
   */
  queryKey: readonly unknown[];
  /** Rows per page */
  pageSize: number;
  /**
   * Fetch one page. The caller owns the failure policy: throw to use the
   * react-query error channel (renders a retry state), or swallow and return
   * an empty page to only toast (the page stays usable).
   */
  fetchPage: (params: {
    pageIndex: number;
    pageSize: number;
  }) => Promise<PagedResult<TItem>>;
  /** Conditional query (e.g. a dependent id is not ready yet) */
  enabled?: boolean;
}

export interface UsePagedQueryReturn<TItem> {
  items: TItem[];
  total: number;
  pageCount: number;
  pageIndex: number;
  pageSize: number;
  setPageIndex: (pageIndex: number) => void;
  /** Nothing to show yet on first paint: render the skeleton */
  isInitialLoading: boolean;
  /**
   * Page transition: the screen still shows the previous page. This is the
   * signal for DataTableContainer's isFetching. A same-key background refetch
   * (tab remount, manual refetch) does not set it, so the table stays silent.
   */
  isPlaceholderData: boolean;
  /** Raw in-flight signal: feeds the toolbar refresh spinner only */
  isFetching: boolean;
  hasData: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

// ============================================
// Hook: usePagedQuery
// ============================================

/**
 * Paged query hook: the single owner of page-index state and loading semantics.
 *
 * keepPreviousData is the whole point. The query key carries the page index;
 * without it every page change is "new key, no data" and the table flashes a
 * skeleton. With it the previous page stays on screen and the transition is
 * shown by the container's top progress bar.
 */
export function usePagedQuery<TItem>({
  queryKey,
  pageSize,
  fetchPage,
  enabled = true,
}: UsePagedQueryOptions<TItem>): UsePagedQueryReturn<TItem> {
  const [pageIndex, setPageIndex] = useState(0);

  const { data, isLoading, isFetching, isPlaceholderData, isError, error, refetch } =
    useQuery({
      queryKey: [...queryKey, pageIndex],
      queryFn: () => fetchPage({ pageIndex, pageSize }),
      placeholderData: keepPreviousData,
      enabled,
    });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasData = items.length > 0;

  // refetch's return value (a QueryObserverResult promise) must not leak to
  // callers: a refresh button needs the single action "fetch again", and a
  // promise only invites ad-hoc error handling at every call site.
  const handleRefetch = useCallback(() => {
    refetch();
  }, [refetch]);

  return {
    items,
    total,
    pageCount: Math.ceil(total / pageSize),
    pageIndex,
    pageSize,
    setPageIndex,
    isInitialLoading: isLoading && !hasData,
    isPlaceholderData,
    isFetching,
    hasData,
    isError,
    error: error as Error | null,
    refetch: handleRefetch,
  };
}
