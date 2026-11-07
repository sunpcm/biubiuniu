/**
 * [INPUT]: Depends on next/headers for the request headers (server actions /
 *          RSC path) and on the Request object (API route path)
 * [OUTPUT]: Exports UNKNOWN_IP sentinel, CLIENT_IP_HEADERS lookup order,
 *           getClientIPFromHeaders, getClientIPFromRequest
 * [POS]: The single source-IP reader in lib/, shared by rate limiting, source
 *        attribution (lib/tracking) and the signup guards. Better Auth's
 *        advanced.ipAddress.ipAddressHeaders references CLIENT_IP_HEADERS
 *        directly (lib/auth/index.ts), so session.ipAddress, the rate-limit key
 *        and every hook see the same address by construction, not by convention
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import "server-only";

import { headers } from "next/headers";
import { CLIENT_IP_HEADERS, UNKNOWN_IP, getClientIPFromRequest, pickClientIP } from "./ip-shared";

// ============================================================================
// Header order: cf-connecting-ip → x-real-ip → x-forwarded-for (first hop)
//
// cf-connecting-ip is written at the Cloudflare edge and cannot be forged by
// the client, so it always wins. x-real-ip precedes x-forwarded-for because
// the former is a single value written by the adjacent reverse proxy, while
// the latter is a chain the client can pre-seed (the first hop IS the forged
// value whenever the edge does not scrub it).
//
// Every header is read as "first hop before the comma": a single-value header
// has no second segment and comes back as-is; a chained header yields the hop
// closest to the client. One rule covers all three, no per-header branch.
//
// A miss falls back to the UNKNOWN_IP sentinel rather than an empty string:
// callers compare against it to ask "is there an IP signal at all" instead of
// each inventing a truthiness check (an empty string would silently skip every
// IP-keyed rule).
// ============================================================================

/** Server actions / RSC path: read the source IP from next/headers. */
export async function getClientIPFromHeaders(): Promise<string> {
  const headersList = await headers();
  return pickClientIP((name) => headersList.get(name));
}

export { CLIENT_IP_HEADERS, UNKNOWN_IP, getClientIPFromRequest };
