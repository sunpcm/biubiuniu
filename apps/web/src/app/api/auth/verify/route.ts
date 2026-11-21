/**
 * Legacy cross-app SSO token verification endpoint — retired.
 *
 * The previous implementation only checked a JWT signature and did not re-check
 * the live session, ban state or role. It is intentionally closed: every verb
 * returns a stable "gone" response, never verifies or reflects a supplied
 * token, and never sets cross-origin CORS headers.
 */

import { NextRequest, NextResponse } from "next/server";

const CLOSED = {
  status: 410,
  body: {
    valid: false,
    error: "SSO_CLOSED",
    message: "Legacy cross-app SSO has been retired and is not available.",
  },
} as const;

export function GET(_request: NextRequest) {
  return NextResponse.json(CLOSED.body, { status: CLOSED.status });
}

export function POST(_request: NextRequest) {
  return NextResponse.json(CLOSED.body, { status: CLOSED.status });
}

export function OPTIONS(_request: NextRequest) {
  return new NextResponse(null, { status: CLOSED.status });
}
