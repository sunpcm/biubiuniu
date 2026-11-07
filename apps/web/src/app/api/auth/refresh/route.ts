/**
 * Legacy cross-app SSO token refresh endpoint — retired.
 *
 * The previous implementation extended a long-lived JWT for a verified
 * signature without re-checking the live session, ban state or role. It is
 * intentionally closed: it never verifies or refreshes a token, never reads or
 * reflects request data, and never sets cross-origin CORS headers.
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

export function POST(_request: NextRequest) {
  return NextResponse.json(CLOSED.body, { status: CLOSED.status });
}

export function OPTIONS(_request: NextRequest) {
  return new NextResponse(null, { status: CLOSED.status });
}
