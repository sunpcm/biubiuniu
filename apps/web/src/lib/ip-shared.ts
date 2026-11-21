/**
 * [INPUT]: None (constants and pure helpers — no next/headers, no server-only)
 * [OUTPUT]: Exports UNKNOWN_IP sentinel, CLIENT_IP_HEADERS lookup order,
 *           getClientIPFromRequest, pickClientIP
 * [POS]: The pure half of lib/ip, shared by server-only lib/ip (which adds the
 *        next/headers reader) and by the injectable auth factory / signup
 *        gift gate, none of which may import next/headers directly. Keeping
 *        the sentinel and header order here means rate limiting, session
 *        ipAddress, signup guards and attribution all read the same address
 *        by construction.
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

/** Sentinel for "no source IP available". Compare against this, never against an empty string. */
export const UNKNOWN_IP = "unknown";

/** Source-IP header lookup order; Better Auth's ipAddressHeaders references it so both sides stay in sync. */
export const CLIENT_IP_HEADERS = ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"] as const;

/** API route path: read the source IP from a Request object. */
export function getClientIPFromRequest(request: Request): string {
  return pickClientIP((name) => request.headers.get(name));
}

export function pickClientIP(get: (name: string) => string | null): string {
  for (const name of CLIENT_IP_HEADERS) {
    const firstHop = get(name)?.split(",")[0].trim();
    if (firstHop) return firstHop;
  }
  return UNKNOWN_IP;
}
