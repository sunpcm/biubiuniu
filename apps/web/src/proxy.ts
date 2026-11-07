/**
 * [INPUT]: Depends on ./i18n/routing's routing config and on
 *          @/lib/tracking/capture's captureAttributionCookie
 * [OUTPUT]: Exports the proxy middleware (locale detection / redirect / cookie
 *           memory + signup-attribution cookie capture) and config.matcher
 * [POS]: The edge interception layer — the matcher's locale union must stay in
 *        sync with i18n/routing's locales, since a missing locale 404s every URL
 *        in that language; attribution capture appends Set-Cookie to the intl
 *        response, so redirect responses carry it too
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import createIntlMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_LOCALE,
  resolveLocaleFallbackUrl,
  routing,
} from './i18n/routing';
import { captureAttributionCookie } from './lib/tracking/capture';

const intlMiddleware = createIntlMiddleware(routing);

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const fallbackUrl = resolveLocaleFallbackUrl(
    request.nextUrl.pathname,
    request.nextUrl.search,
  );
  if (fallbackUrl !== `${request.nextUrl.pathname}${request.nextUrl.search}`) {
    const target = new URL(fallbackUrl, request.url);
    const response = NextResponse.redirect(target);
    response.cookies.set("NEXT_LOCALE", DEFAULT_LOCALE, {
      path: "/",
      sameSite: "lax",
    });
    captureAttributionCookie(request, response);
    return response;
  }

  const intlResponse = intlMiddleware(request);

  // Signup attribution: the first document navigation carrying utm / aff / an
  // off-site Referer lands the cookie here — no dependence on browser JS nor on
  // which login entry point is used, so One Tap signups get a source too
  captureAttributionCookie(request, intlResponse);

  return intlResponse;
}

export const config = {
  matcher: [
    // Enable a redirect to a matching locale at the root
    '/',

    // Set a cookie to remember the previous locale for
    // all requests that have a locale prefix
    '/(en|zh|ja)/:path*',

    // Enable redirects that add missing locales
    // (e.g. `/pathnames` -> `/en/pathnames`)
    '/((?!api|_next|_vercel|auth|privacy-policy|terms-of-service|refund-policy|.*\\.|favicon.ico).*)'
  ]
};
