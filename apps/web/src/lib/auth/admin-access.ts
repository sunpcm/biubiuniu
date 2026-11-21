/**
 * Admin-plugin access table. Thin re-export of `@sunpcm/niu-auth` so the
 * server (`index.ts`) and the client (`auth-client.ts`) share one copy, and
 * the domain tests exercise the exact shipped access table.
 */
export {
  adminAccessControl,
  adminAccessRoles,
  IMPERSONATION_SESSION_DURATION_SECONDS,
} from "@sunpcm/niu-auth";
