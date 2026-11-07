/**
 * Legacy cross-app SSO token endpoint — retired.
 *
 * The previous implementation issued a long-lived JWT for an authenticated
 * session and returned it to any origin in the configured allow-list. It is
 * intentionally closed: this route never reads a redirect/state/code/token
 * parameter, never issues or refreshes a token, never reflects request data,
 * and never sets cross-origin CORS headers.
 *
 * A real OIDC/OAuth integration, if reintroduced, must be a maintained
 * implementation with an exact callback allow-list, PKCE, one-time short-lived
 * codes and revocation — not a token generator at this path.
 */

import { NextRequest, NextResponse } from "next/server";

const CLOSED = {
  status: 410,
  body: {
    success: false,
    error: "SSO_CLOSED",
    message: "Legacy cross-app SSO has been retired and is not available.",
  },
} as const;

export function GET(_request: NextRequest) {
  return NextResponse.json(CLOSED.body, { status: CLOSED.status });
}

export function OPTIONS(_request: NextRequest) {
  return new NextResponse(null, { status: CLOSED.status });
}
