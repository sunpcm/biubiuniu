/**
 * [INPUT]: Depends on next/server's NextRequest / NextResponse types and on
 *          ./shared for the cookie source of truth, the consent rule and the
 *          mergeAttribution merge rule
 * [OUTPUT]: Exports captureAttributionCookie(request, response) — reads utm /
 *           aff / off-site Referer on every document navigation and writes the
 *           user_tracking_data cookie under "first touch carrying a signal wins"
 * [POS]: The request-side half of lib/tracking, consumed only by proxy.ts; it
 *        depends on neither browser JS nor on which login entry point was used,
 *        so One Tap / the login dialog / /login / a magic link opened in the
 *        same browser are all covered. server.ts persists the row, client.ts
 *        tops up the device fields
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import type { NextRequest, NextResponse } from 'next/server'

import {
  CONSENT_COOKIE_NAME,
  isTrackingConsentGranted,
  isTrackingEnabled,
  mergeAttribution,
  parseTrackingCookie,
  readAttributionFromRequest,
  TRACKING_COOKIE_MAX_AGE_DAYS,
  TRACKING_COOKIE_NAME,
} from './shared'

// ─────────────────────────────────────────────────────────────
// Real document navigations only
//
// RSC soft navigations and Link prefetches also pass through the proxy, but
// they carry the headers below; without skipping them a prefetched path gets
// recorded as the landing page and the Referer is forever our own site.
// ─────────────────────────────────────────────────────────────
function isDocumentNavigation(request: NextRequest): boolean {
  if (request.method !== 'GET') return false
  const h = request.headers
  if (h.has('rsc') || h.has('next-router-prefetch')) return false
  if (h.get('purpose') === 'prefetch') return false
  if (h.get('sec-purpose')?.includes('prefetch')) return false
  return true
}

/** Behind a reverse proxy nextUrl's host/protocol are internal values; the landing page needs the public ones */
function publicUrl(request: NextRequest): URL {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwardedHost || request.headers.get('host') || request.nextUrl.host
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
    request.nextUrl.protocol.replace(':', '')
  return new URL(`${proto}://${host}${request.nextUrl.pathname}${request.nextUrl.search}`)
}

export function captureAttributionCookie(request: NextRequest, response: NextResponse): void {
  if (!isTrackingEnabled()) return
  if (!isDocumentNavigation(request)) return
  if (!isTrackingConsentGranted(request.cookies.get(CONSENT_COOKIE_NAME)?.value)) return

  const url = publicUrl(request)
  const existing = parseTrackingCookie(request.cookies.get(TRACKING_COOKIE_NAME)?.value)
  const next = mergeAttribution(
    existing,
    readAttributionFromRequest({ url, referer: request.headers.get('referer') }),
  )
  if (!next) return

  response.cookies.set({
    name: TRACKING_COOKIE_NAME,
    value: JSON.stringify(next),
    maxAge: TRACKING_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60,
    path: '/',
    sameSite: 'lax',
    secure: url.protocol === 'https:',
  })
}
