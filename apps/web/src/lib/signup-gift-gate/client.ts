/**
 * [INPUT]: Depends on js-cookie for the cookie write, the browser's navigator /
 *          screen / Intl / WebGL signals, ./shared for the cookie name and lifetime
 * [OUTPUT]: Exports saveDeviceSignal (collect hardware + browser signals ->
 *           SHA-256 -> cookie; skipped when the cookie exists; any failure is
 *           swallowed, it never throws)
 * [POS]: The client half of lib/signup-gift-gate, called by
 *        components/auth/DeviceSignalCollector from the root layout; the server
 *        half (the decision) is index.ts
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */
'use client'

import Cookies from 'js-cookie'

import {
  DEVICE_SIGNAL_COOKIE_MAX_AGE_DAYS,
  DEVICE_SIGNAL_COOKIE_NAME,
} from './shared'

// ─────────────────────────────────────────────────────────────
// Signal collection: only what follows the person, not the network
//
// A VPN changes the IP and the country; a private window drops cookies and
// localStorage. Neither is on the list below. Screen, time zone, language,
// CPU cores, memory tier, touch points and GPU model stay the same no matter
// which exit IP is used. Only the hash is uploaded; the raw signals never
// leave the browser.
// ─────────────────────────────────────────────────────────────
function readWebGlRenderer(): string {
  try {
    const canvas = document.createElement('canvas')
    const gl =
      canvas.getContext('webgl') ??
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null)
    if (!gl) return 'no-webgl'
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    if (!info) return gl.getParameter(gl.RENDERER) as string
    return [
      gl.getParameter(info.UNMASKED_VENDOR_WEBGL),
      gl.getParameter(info.UNMASKED_RENDERER_WEBGL),
    ].join('/')
  } catch {
    return 'webgl-error'
  }
}

function collectDeviceSignals(): string[] {
  const nav = navigator as Navigator & { deviceMemory?: number }
  return [
    nav.userAgent,
    nav.platform,
    nav.language,
    (nav.languages ?? []).join(','),
    String(screen.width),
    String(screen.height),
    String(screen.colorDepth),
    String(window.devicePixelRatio),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    String(nav.hardwareConcurrency ?? ''),
    String(nav.deviceMemory ?? ''),
    String(nav.maxTouchPoints ?? ''),
    readWebGlRenderer(),
  ]
}

// ─────────────────────────────────────────────────────────────
// Hashing: SHA-256 first; outside a secure context (plain-http LAN debugging)
// there is no subtle crypto, so fall back to FNV-1a. Both produce hex, and the
// server's shape check treats them alike
// ─────────────────────────────────────────────────────────────
async function hashSignals(signals: string[]): Promise<string> {
  const input = signals.join('|')
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  }
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0').repeat(2)
}

/**
 * Called once on mount. An existing cookie is left alone (once a day); only a
 * missing one triggers collect -> hash -> write. A failure merely means this
 * device contributes one signal less to this signup, and the server treats a
 * missing signal as "let it through".
 */
export async function saveDeviceSignal(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    if (Cookies.get(DEVICE_SIGNAL_COOKIE_NAME)) return
    const hash = await hashSignals(collectDeviceSignals())
    Cookies.set(DEVICE_SIGNAL_COOKIE_NAME, hash, {
      expires: DEVICE_SIGNAL_COOKIE_MAX_AGE_DAYS,
      sameSite: 'lax',
    })
  } catch {
    // Silent on failure: a missing risk signal must never become a page error
  }
}
