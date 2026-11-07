/**
 * Built-in Better Auth admin HTTP mutations the app does not consume. The app's
 * guarded server actions are the authoritative path for role changes / account
 * deletion, so a plain admin must not reach these built-in endpoints.
 */
export const ADMIN_DISABLED_PATHS: string[] = [
  "/admin/set-role",
  "/admin/create-user",
  "/admin/list-users",
  "/admin/ban-user",
  "/admin/unban-user",
  "/admin/remove-user",
  "/admin/set-user-password",
  "/admin/update-user",
  "/admin/get-user",
  "/admin/list-user-sessions",
  "/admin/revoke-user-session",
  "/admin/revoke-user-sessions",
];
