/**
 * Pure client-IP helpers shared by the auth factory, signup guards and rate
 * limiter. No `next/headers`, no `server-only`.
 */

/** Sentinel for "no source IP available". Compare against this, never against "". */
export const UNKNOWN_IP = "unknown";

/** Source-IP header lookup order. Better Auth's `ipAddressHeaders` references it. */
export const CLIENT_IP_HEADERS = [
  "cf-connecting-ip",
  "x-real-ip",
  "x-forwarded-for",
] as const;

export function pickClientIP(get: (name: string) => string | null): string {
  for (const name of CLIENT_IP_HEADERS) {
    const firstHop = get(name)?.split(",")[0].trim();
    if (firstHop) return firstHop;
  }
  return UNKNOWN_IP;
}
