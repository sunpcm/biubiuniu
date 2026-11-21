/**
 * [INPUT]: None (constants and pure functions, usable on both server and client)
 * [OUTPUT]: Exports DEVICE_SIGNAL_COOKIE_NAME (the device-fingerprint cookie),
 *           DEVICE_SIGNAL_COOKIE_MAX_AGE_DAYS, isValidDeviceHash (shape check of
 *           the cookie value: 16 to 64 hex chars, the only gate before a Redis key)
 * [POS]: The shared layer of lib/signup-gift-gate; client.ts writes the cookie and
 *        index.ts reads it under the name defined here
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

/** The browser-computed device-fingerprint hash travels to the server in this cookie with the signup request */
export const DEVICE_SIGNAL_COOKIE_NAME = 'device_signal'

/** Cookie lifetime; once it expires the next page load recomputes the hash, the fingerprint itself does not depend on the cookie */
export const DEVICE_SIGNAL_COOKIE_MAX_AGE_DAYS = 1

// ─────────────────────────────────────────────────────────────
// Shape check: the cookie is client-controlled input, so only a hex hash may
// ever become part of a Redis key
// ─────────────────────────────────────────────────────────────
const DEVICE_HASH_PATTERN = /^[a-f0-9]{16,64}$/

export function isValidDeviceHash(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_HASH_PATTERN.test(value)
}
