/**
 * [INPUT]: depends only on @/config/common resource-prefix declarations
 * [OUTPUT]: exports small pure R2 object-policy helpers used by the
 *           r2-resources Server Actions to authorize presigned uploads and
 *           downloads against explicit resource namespaces
 * [POS]: lib/storage security boundary; identity/rate limits alone must never
 *        grant a presigned signature for an arbitrary caller path
 * [PROTOCOL]: Update this header when changed, then check CLAUDE.md
 */

import {
  ADMIN_IMAGE_PREFIXES,
  PUBLIC_READ_PREFIXES,
  PUBLIC_UPLOAD_SCRATCH_PATH,
  userAvatarsPath,
} from "@/config/common";

export type R2AccessPrincipal = "admin" | "user" | "public";

const ENCODED_TRAVERSAL = /%(?:2f|5c|2e)/i;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Validate a relative object directory path (or full object key) into its
 * normalized, separator-joined form. Returns null when the input is empty,
 * absolute, contains backslashes, empty/`.`/`..` segments, encoded traversal
 * sequences or control characters.
 */
export function normalizeObjectPath(path: string): string | null {
  const trimmed = path.trim();
  if (trimmed === "" || trimmed.startsWith("/")) return null;
  if (trimmed.includes("\\") || trimmed.includes("\0")) return null;
  if (ENCODED_TRAVERSAL.test(trimmed)) return null;

  const segments = trimmed.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }
  if (segments.some((segment) => hasControlCharacter(segment))) return null;

  return segments.join("/");
}

/**
 * Validate a filename component (a filename or a filename prefix). Unlike a
 * directory path, dots are allowed so file extensions survive, but separators
 * and traversal markers are rejected so they cannot inject a new path segment.
 */
export function normalizeFilenamePart(part: string): string | null {
  const trimmed = part.trim();
  if (trimmed === "" || trimmed === "." || trimmed === "..") return null;
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) return null;
  if (ENCODED_TRAVERSAL.test(trimmed)) return null;
  if (hasControlCharacter(trimmed)) return null;
  return trimmed;
}

export interface UploadPolicyResult {
  allowed: boolean;
  reason?: "invalid" | "forbidden";
  normalizedPath?: string;
  normalizedPrefix?: string;
}

/**
 * Authorize a presigned upload directory for a principal.
 *
 * - admin: only declared CMS image prefixes.
 * - user: only the session user's own avatar prefix.
 * - public: only the anonymous writable scratch prefix.
 */
export function evaluateUploadPolicy(
  principal: R2AccessPrincipal,
  userId: string | null,
  path: string,
  prefix?: string,
): UploadPolicyResult {
  const normalizedPath = normalizeObjectPath(path);
  if (!normalizedPath) return { allowed: false, reason: "invalid" };

  let allowed = false;
  if (principal === "admin") {
    allowed = ADMIN_IMAGE_PREFIXES.some((candidate) => candidate === normalizedPath);
  } else if (principal === "user") {
    allowed = userId !== null && normalizedPath === userAvatarsPath(userId);
  } else {
    allowed = normalizedPath === PUBLIC_UPLOAD_SCRATCH_PATH;
  }

  if (!allowed) return { allowed: false, reason: "forbidden" };

  if (prefix !== undefined) {
    const normalizedPrefix = normalizeFilenamePart(prefix);
    if (!normalizedPrefix) return { allowed: false, reason: "invalid" };
    return { allowed: true, normalizedPath, normalizedPrefix };
  }

  return { allowed: true, normalizedPath };
}

function matchesPrefix(segments: string[], prefix: string): boolean {
  const prefixSegments = prefix.split("/");
  return (
    segments.length > prefixSegments.length &&
    prefixSegments.every((segment, index) => segments[index] === segment)
  );
}

/**
 * Authorize a presigned download object key for a principal.
 *
 * - admin: any well-formed object key.
 * - user: only the session user's own avatar prefix or public read prefixes.
 * - public: only public read prefixes.
 *
 * Matching is by complete path segment, so `avatars/userA` never matches
 * `avatars/userAB`.
 */
export function evaluateDownloadPolicy(
  principal: R2AccessPrincipal,
  userId: string | null,
  key: string,
): boolean {
  const normalizedKey = normalizeObjectPath(key);
  if (!normalizedKey) return false;

  if (principal === "admin") return true;

  const segments = normalizedKey.split("/");
  const allowedPrefixes =
    principal === "user"
      ? [...(userId ? [userAvatarsPath(userId)] : []), ...PUBLIC_READ_PREFIXES]
      : PUBLIC_READ_PREFIXES;

  return allowedPrefixes.some((prefix) => matchesPrefix(segments, prefix));
}
