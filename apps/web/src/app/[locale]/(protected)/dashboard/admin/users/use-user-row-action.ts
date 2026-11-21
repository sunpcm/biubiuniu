"use client";

/**
 * [INPUT]: Depends on @/hooks/use-optimistic-row-action's useOptimisticRowAction,
 *          @tanstack/react-query's useQueryClient, @/actions/users/admin's
 *          UserWithSource
 * [OUTPUT]: Exports ADMIN_USERS_QUERY_KEY (the user table's cache key, single
 *           source of truth), useUserRowAction (the row-action submit channel
 *           bound to the user table) and useRefreshUsersTable (silent refresh
 *           when there is no optimistic patch to apply)
 * [POS]: The write side of admin/users: DataTable fetches under the key,
 *        Columns and AdjustCreditsDialog write back through it; ban / role /
 *        delete all go through this one channel
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import type { UserWithSource } from "@/actions/users/admin";
import { useOptimisticRowAction } from "@/hooks/use-optimistic-row-action";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/** Module-level constant: a stable reference is what lets useOptimisticRowAction memoize */
export const ADMIN_USERS_QUERY_KEY = ["admin-users"] as const;

const getUserRowId = (user: UserWithSource) => user.id;

export function useUserRowAction() {
  return useOptimisticRowAction<UserWithSource>({
    queryKey: ADMIN_USERS_QUERY_KEY,
    getRowId: getUserRowId,
  });
}

/**
 * Refresh channel for when no optimistic patch is possible (the new value is
 * the server's call and cannot be guessed, e.g. the balance after a credit
 * adjustment): a silent invalidate, the table never flashes a skeleton.
 */
export function useRefreshUsersTable() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [...ADMIN_USERS_QUERY_KEY] });
  }, [queryClient]);
}
