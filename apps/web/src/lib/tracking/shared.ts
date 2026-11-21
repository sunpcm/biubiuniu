/**
 * [INPUT]: No runtime dependencies (pure types + pure functions, shared by the
 *          browser, the proxy and the server)
 * [OUTPUT]: Exports the ClientTrackingData / AttributionBlock / ParsedUserAgent /
 *           GeoLocationData / UserSourceData types, TRACKING_COOKIE_NAME and its
 *           max age, CONSENT_COOKIE_NAME, parseTrackingCookie, isTrackingEnabled,
 *           isTrackingConsentGranted, hasAttributionSignal,
 *           readAttributionFromRequest, mergeAttribution
 * [POS]: The source of truth of lib/tracking — the attribution cookie's shape and
 *        the "first touch carrying a signal wins" merge rule both live here;
 *        capture.ts (writes the attribution block from the proxy) and client.ts
 *        (tops up the device block in the browser) are only adapters, and
 *        server.ts reads the cookie and persists the row
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/** Shape of the attribution cookie: attribution block (utm/aff/referrer/landingPage) + device block (screen/language/timezone) */
export interface ClientTrackingData {
  // Affiliate code
  affCode?: string
  // UTM parameters
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmTerm?: string
  utmContent?: string
  // Referrer
  referrer?: string
  landingPage?: string
  // Device info
  screenWidth?: number
  screenHeight?: number
  language?: string
  timezone?: string
}

/** Attribution block: every source field one touch produces — written as a whole, never field by field */
export type AttributionBlock = Pick<
  ClientTrackingData,
  'affCode' | 'utmSource' | 'utmMedium' | 'utmCampaign' | 'utmTerm' | 'utmContent' | 'referrer' | 'landingPage'
>

/** Server-side user-agent parse result */
export interface ParsedUserAgent {
  browser?: string
  browserVersion?: string
  os?: string
  osVersion?: string
  deviceType?: string
  deviceBrand?: string
  deviceModel?: string
}

/** Geo data carried by the Cloudflare headers */
export interface GeoLocationData {
  ipAddress?: string
  countryCode?: string
}

/** Full shape of a user_source row */
export interface UserSourceData {
  userId: string
  // Affiliate code
  affCode?: string
  // UTM
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmTerm?: string
  utmContent?: string
  // Referrer
  referrer?: string
  referrerDomain?: string
  landingPage?: string
  // Device & Browser
  userAgent?: string
  browser?: string
  browserVersion?: string
  os?: string
  osVersion?: string
  deviceType?: string
  deviceBrand?: string
  deviceModel?: string
  screenWidth?: number
  screenHeight?: number
  language?: string
  timezone?: string
  // Network & Location
  ipAddress?: string
  countryCode?: string
  // Extra
  metadata?: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────
// Cookie source of truth and feature switches
// ─────────────────────────────────────────────────────────────

export const TRACKING_COOKIE_NAME = 'user_tracking_data'
export const TRACKING_COOKIE_MAX_AGE_DAYS = 30
export const CONSENT_COOKIE_NAME = 'cookieConsent'

export function isTrackingEnabled(): boolean {
  return process.env.NEXT_PUBLIC_USER_SOURCE_TRACKING_ENABLED === 'true'
}

/**
 * Consent rule, shared verbatim by the browser and the proxy: with the consent
 * feature off everything is allowed; with it on only an explicit refusal
 * (cookieConsent="false") blocks, and no answer yet counts as implicit consent.
 */
export function isTrackingConsentGranted(consentCookieValue: string | undefined): boolean {
  if (process.env.NEXT_PUBLIC_COOKIE_CONSENT_ENABLED !== 'true') return true
  return consentCookieValue !== 'false'
}

/**
 * Parse the cookie value. Both Next's cookies() and js-cookie hand back an
 * already-decoded string, so JSON.parse goes first; a second attempt covers
 * legacy values that were encodeURIComponent'd by hand.
 */
export function parseTrackingCookie(cookieValue: string | undefined): ClientTrackingData | null {
  if (!cookieValue) return null
  for (const candidate of [cookieValue, safeDecode(cookieValue)]) {
    if (candidate === null) continue
    try {
      const parsed: unknown = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object') return parsed as ClientTrackingData
    } catch {
      // try the next candidate
    }
  }
  return null
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────
// Attribution: read a request → merge rule
//
// A "signal" is any non-empty utm field, aff code, or off-site referrer.
// landingPage is not a signal: someone who typed the URL in still has a
// landing page, but no source.
// ─────────────────────────────────────────────────────────────

const SIGNAL_KEYS = [
  'utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent', 'affCode', 'referrer',
] as const satisfies ReadonlyArray<keyof AttributionBlock>

export function hasAttributionSignal(data: Partial<ClientTrackingData> | null | undefined): boolean {
  return !!data && SIGNAL_KEYS.some((key) => !!data[key])
}

/** Read the attribution block off one document navigation; a same-site Referer is not a source (in-app hops are not traffic entries) */
export function readAttributionFromRequest(input: { url: URL; referer?: string | null }): AttributionBlock {
  const params = input.url.searchParams
  return compact({
    utmSource: params.get('utm_source') || undefined,
    utmMedium: params.get('utm_medium') || undefined,
    utmCampaign: params.get('utm_campaign') || undefined,
    utmTerm: params.get('utm_term') || undefined,
    utmContent: params.get('utm_content') || undefined,
    affCode: params.get('aff') || params.get('via') || params.get('ref') || undefined,
    referrer: externalReferrer(input.referer, input.url.hostname),
    landingPage: input.url.href,
  })
}

/** Drop undefined keys: the cookie keeps no empty slots, and a merge can never blank an existing value with undefined */
function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

function externalReferrer(referer: string | null | undefined, ownHost: string): string | undefined {
  if (!referer) return undefined
  try {
    const refererHost = new URL(referer).hostname
    return normalizeHost(refererHost) === normalizeHost(ownHost) ? undefined : referer
  } catch {
    return undefined
  }
}

/**
 * Merge rule: the first touch carrying a signal wins.
 * - No cookie yet: the whole block lands (landingPage is recorded even with no signal)
 * - Cookie already carries a signal: keep it as is, write nothing
 * - Cookie has no signal and this touch does: swap the attribution block wholesale
 *   (landingPage included), keep the device block
 * Returns null when no cookie write is needed.
 */
export function mergeAttribution(
  existing: ClientTrackingData | null,
  incoming: AttributionBlock,
): ClientTrackingData | null {
  if (!existing) return { ...incoming }
  if (hasAttributionSignal(existing)) return null
  if (!hasAttributionSignal(incoming)) return null
  return { ...existing, ...incoming }
}
