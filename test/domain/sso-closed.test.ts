/**
 * Legacy cross-app SSO closed-contract (C09).
 *
 * The retired token/verify/refresh endpoints and the cross-login page must
 * return a stable "gone" response, must never issue/refresh/verify a token,
 * must never echo a supplied redirect/state/code/token, and must not set
 * permissive cross-origin headers. These assertions exercise the real route
 * handlers with hostile inputs (controller-run, no live external client).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  GET as tokenGET,
  OPTIONS as tokenOPTIONS,
} from "@/app/api/auth/token/route";
import {
  GET as verifyGET,
  POST as verifyPOST,
  OPTIONS as verifyOPTIONS,
} from "@/app/api/auth/verify/route";
import {
  POST as refreshPOST,
  OPTIONS as refreshOPTIONS,
} from "@/app/api/auth/refresh/route";

const SENTINELS = [
  "redirect=https://evil.example/cb",
  "token=legacy.jwt.token.sentinel",
  "state=00000000-0000-4000-8000-000000000000",
  "code=one-time-code-replay",
];

function hostileRequest(path: string): NextRequest {
  const url = new URL(path, "http://127.0.0.1:3000");
  url.search = SENTINELS.join("&");
  return new NextRequest(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SENTINELS[1]}`,
      origin: "https://evil.example",
      "content-type": "application/json",
    },
    body: JSON.stringify({ token: SENTINELS[1], code: SENTINELS[3] }),
  });
}

async function assertClosed(response: Response) {
  assert.equal(response.status, 410);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  const body = await response.json();
  assert.equal(body.error, "SSO_CLOSED");
  const text = JSON.stringify(body);
  for (const sentinel of SENTINELS) {
    assert.ok(!text.includes(sentinel), "response must not echo request data");
  }
}

test("token endpoint is closed for GET and OPTIONS", async () => {
  const request = hostileRequest("/api/auth/token");
  await assertClosed(tokenGET(request));
  assert.equal((await tokenOPTIONS(request)).status, 410);
});

test("verify endpoint is closed for GET, POST and OPTIONS", async () => {
  const request = hostileRequest("/api/auth/verify");
  await assertClosed(verifyGET(request));
  await assertClosed(verifyPOST(request));
  assert.equal((await verifyOPTIONS(request)).status, 410);
});

test("refresh endpoint is closed for POST and OPTIONS", async () => {
  const request = hostileRequest("/api/auth/refresh");
  await assertClosed(refreshPOST(request));
  assert.equal((await refreshOPTIONS(request)).status, 410);
});
