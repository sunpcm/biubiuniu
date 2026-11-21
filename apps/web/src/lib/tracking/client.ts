/**
 * [INPUT]: Depends on js-cookie for cookie access and on ./shared for the cookie
 *          source of truth and the consent rule
 * [OUTPUT]: Exports syncTrackingDeviceInfo — tops the screen / language /
 *           timezone fields into an attribution cookie that already exists
 * [POS]: The browser half of lib/tracking: it fills in the device block only and
 *        never writes the attribution block (that is capture.ts's job inside the
 *        proxy — each side owns its own fields); called by
 *        components/tracking/UserSourceDeviceSync, mounted in the root layout
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

'use client'

import Cookies from 'js-cookie'

import {
  CONSENT_COOKIE_NAME,
  isTrackingConsentGranted,
  isTrackingEnabled,
  parseTrackingCookie,
  TRACKING_COOKIE_MAX_AGE_DAYS,
  TRACKING_COOKIE_NAME,
  type ClientTrackingData,
} from './shared'

type DeviceBlock = Pick<ClientTrackingData, 'screenWidth' | 'screenHeight' | 'language' | 'timezone'>

function readDeviceBlock(): DeviceBlock {
  return {
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

function sameDevice(a: DeviceBlock, b: DeviceBlock): boolean {
  return (
    a.screenWidth === b.screenWidth &&
    a.screenHeight === b.screenHeight &&
    a.language === b.language &&
    a.timezone === b.timezone
  )
}

/**
 * With no cookie present, do nothing: the attribution block is laid down by the
 * proxy first, so a missing cookie means this document request never hit the
 * proxy matcher. The next navigation fills it in — the browser does not race
 * ahead to forge a shell with no source in it.
 */
export function syncTrackingDeviceInfo(): void {
  if (typeof window === 'undefined') return
  if (!isTrackingEnabled()) return
  if (!isTrackingConsentGranted(Cookies.get(CONSENT_COOKIE_NAME))) return

  const existing = parseTrackingCookie(Cookies.get(TRACKING_COOKIE_NAME))
  if (!existing) return

  const device = readDeviceBlock()
  if (sameDevice(existing, device)) return

  Cookies.set(TRACKING_COOKIE_NAME, JSON.stringify({ ...existing, ...device }), {
    expires: TRACKING_COOKIE_MAX_AGE_DAYS,
    sameSite: 'lax',
    path: '/',
  })
}
