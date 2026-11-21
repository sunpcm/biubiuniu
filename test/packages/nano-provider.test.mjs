import assert from "node:assert/strict";
import test from "node:test";

import { createGoogleNanoProvider } from "../../packages/feature-nano/dist/provider/google.js";

/**
 * Transport-level regression for the Google Nano provider, using the real
 * `@google/genai` SDK against a memory `fetch` transport. Every case asserts
 * the actual number of transport calls (a single attempt; no auto-retry) and
 * the `unknown` flag of the sanitized `NanoProviderError`.
 *
 * The provider keeps `@google/genai` as its only SDK import; this test drives
 * it through the real SDK transport boundary rather than faking SDK return
 * values, so the SDK's own error classification code path runs.
 */

const { ReadableStream, TextEncoder } = globalThis;

function jsonResponse(status) {
  return new Response(
    JSON.stringify({ error: { code: status, message: "m", status: "s" } }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function sseResponse(events) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events) {
          if (event === "ABORT") {
            controller.error(new Error("socket hang up"));
            return;
          }
          controller.enqueue(new TextEncoder().encode(event));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

const IMAGE_CHUNK =
  'data: {"candidates":[{"content":{"parts":[{"inlineData":{"data":"AA==","mimeType":"image/png"}}]}}]}\n\n';

const REQUEST = { prompt: "hi", imageData: null, mimeType: null, model: "m" };

async function runWithTransport(transport, fn) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls += 1;
    return transport(url, init);
  };
  try {
    const value = await fn();
    return { calls, value };
  } catch (error) {
    return { calls, error };
  } finally {
    globalThis.fetch = original;
  }
}

function assertRejected(actual, expectedUnknown) {
  assert.ok(actual.error, "must reject");
  assert.equal(actual.error.name, "NanoProviderError");
  assert.equal(actual.error.unknown, expectedUnknown);
}

test("a determinate 4xx HTTP rejection is not unknown and is sent once", async () => {
  for (const status of [400, 401, 403, 429]) {
    const outcome = await runWithTransport(
      () => jsonResponse(status),
      () => createGoogleNanoProvider({ apiKey: "k", model: "m" }).generate(REQUEST),
    );
    assert.equal(outcome.calls, 1, `status ${status} must be sent exactly once`);
    assertRejected(outcome, false);
  }
});

test("a 5xx or lost-response failure stays unknown and is sent once", async () => {
  const cases = [
    ["500", () => jsonResponse(500)],
    ["503", () => jsonResponse(503)],
    ["lost response", () => { throw new TypeError("fetch failed"); }],
  ];
  for (const [name, transport] of cases) {
    const outcome = await runWithTransport(
      transport,
      () => createGoogleNanoProvider({ apiKey: "k", model: "m" }).generate(REQUEST),
    );
    assert.equal(outcome.calls, 1, `${name} must be sent exactly once`);
    assertRejected(outcome, true);
  }
});

test("a stream that partially delivers and then fails stays unknown", async () => {
  const outcome = await runWithTransport(
    () => sseResponse([IMAGE_CHUNK, "ABORT"]),
    () => createGoogleNanoProvider({ apiKey: "k", model: "m" }).generate(REQUEST),
  );
  assert.equal(outcome.calls, 1, "partial stream must still be a single transport call");
  assertRejected(outcome, true);
});

test("a complete image response is returned and sent once", async () => {
  const outcome = await runWithTransport(
    () => sseResponse([IMAGE_CHUNK]),
    () => createGoogleNanoProvider({ apiKey: "k", model: "m" }).generate(REQUEST),
  );
  assert.equal(outcome.calls, 1);
  assert.ok(outcome.value, "must resolve");
  assert.equal(outcome.value.images.length, 1);
  assert.equal(outcome.value.images[0].dataBase64, "AA==");
  assert.equal(outcome.value.images[0].mimeType, "image/png");
});
