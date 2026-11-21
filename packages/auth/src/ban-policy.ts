/**
 * Single source of truth for "is this account currently banned", shared by the
 * fresh-session guard and the HTTP/SDK write boundary mounted in the factory.
 */

export function isBanActive(
  banned: boolean | null | undefined,
  banExpires: Date | string | number | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!banned) return false;
  if (banExpires == null) return true;
  return new Date(banExpires).getTime() > now.getTime();
}

/** Mutating endpoints a banned user must still reach to sign out / revoke sessions. */
export const BANNED_USER_ALLOWED_PATHS: ReadonlySet<string> = new Set([
  "/sign-out",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
]);

/** Read-only session queries a banned user may reach; guards still re-read ban state. */
export const BANNED_USER_READ_ONLY_PATHS: ReadonlySet<string> = new Set([
  "/get-session",
  "/list-sessions",
]);
