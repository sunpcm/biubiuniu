"use client";

/**
 * [INPUT]: Depends on @tanstack/react-query's useQueryClient, sonner's toast,
 *          @/lib/action-response's ActionResult
 * [OUTPUT]: Exports the useOptimisticRowAction hook and the RowPatch / TablePage /
 *           RowActionParams types: the single submit channel for table row
 *           actions (optimistic patch -> server action in the background ->
 *           silent invalidate on success for the truth, snapshot rollback +
 *           error toast on failure)
 * [POS]: The write side of the data-table hooks, paired with use-data-table (the
 *        read side); a table binds its queryKey once and hands the result to its
 *        row-action dialogs (see admin/users/use-user-row-action)
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import type { ActionResult } from "@/lib/action-response";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** The page shape use-data-table stores in the query cache */
export type TablePage<TRow> = { data: TRow[]; totalCount: number };

/**
 * Row patch. Object form = merge fields; function form = replace the row,
 * and returning null means the row disappears (delete-type actions reuse the
 * same channel instead of opening a second branch).
 */
export type RowPatch<TRow> = Partial<TRow> | ((row: TRow) => TRow | null);

export interface RowActionParams<TRow> {
  /** Target row id */
  rowId: string;
  /** The server action. Without a patch this degrades to "silent refresh on success" */
  run: () => Promise<ActionResult>;
  /** Optimistic patch; omit to leave the cache alone and only refresh on success */
  patch?: RowPatch<TRow>;
  /** Success toast; omit for no toast */
  success?: string;
  /** Failure toast title */
  failure: string;
}

interface Options<TRow> {
  /** Table queryKey prefix (use-data-table appends page / filters / sorting) */
  queryKey: readonly string[];
  getRowId: (row: TRow) => string;
}

/* ------------------------------------------------------------------ */
/*  Patch application                                                  */
/* ------------------------------------------------------------------ */

/** Only a hit produces a new object; an untouched page is returned as-is so the table does not re-render for nothing */
function patchPage<TRow>(
  page: TablePage<TRow> | undefined,
  rowId: string,
  getRowId: (row: TRow) => string,
  patch: RowPatch<TRow>
): TablePage<TRow> | undefined {
  if (!page) return page;

  let touched = false;
  let removed = 0;
  const rows: TRow[] = [];

  for (const row of page.data) {
    if (getRowId(row) !== rowId) {
      rows.push(row);
      continue;
    }
    touched = true;
    const next = typeof patch === "function" ? patch(row) : { ...row, ...patch };
    if (next === null) {
      removed += 1;
      continue;
    }
    rows.push(next);
  }

  if (!touched) return page;
  return { data: rows, totalCount: Math.max(0, page.totalCount - removed) };
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * Row-action submit channel.
 *
 * Why not router.refresh(): the rows live in the React Query cache and
 * router.refresh() re-renders the RSC tree. The two are not connected, so the
 * table would stay stale.
 *
 * Why not await: once the admin confirms they should be free to move on. The
 * action runs in the background while the screen already shows the expected
 * outcome; the truth is filled in by the invalidate on success. A same-key
 * background refetch is silent in use-data-table (isPlaceholderData stays
 * false), so the table never flashes a skeleton. Only a failure rolls back and
 * surfaces the server's reason verbatim.
 */
export function useOptimisticRowAction<TRow>({
  queryKey,
  getRowId,
}: Options<TRow>) {
  const queryClient = useQueryClient();

  return useCallback(
    ({ rowId, run, patch, success, failure }: RowActionParams<TRow>) => {
      const filter = { queryKey: [...queryKey] };

      // An in-flight fetch would land with stale rows and overwrite the patch
      // that was just applied, so cancel it first
      void queryClient.cancelQueries(filter);

      const snapshots = patch
        ? queryClient.getQueriesData<TablePage<TRow>>(filter)
        : [];

      if (patch) {
        queryClient.setQueriesData<TablePage<TRow>>(filter, (page) =>
          patchPage(page, rowId, getRowId, patch)
        );
      }

      void (async () => {
        let res: ActionResult;
        try {
          res = await run();
        } catch (error) {
          res = {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }

        if (res.success) {
          if (success) toast.success(success);
          void queryClient.invalidateQueries(filter);
          return;
        }

        // The server did not change anything, so the snapshot is the truth:
        // put it back as-is, no extra round trip
        for (const [key, data] of snapshots) {
          queryClient.setQueryData(key, data);
        }
        toast.error(failure, { description: res.error });
      })();
    },
    [queryClient, queryKey, getRowId]
  );
}
