/**
 * Pure (no-PG, no-network) validation checks for Nano image admission.
 *
 * Verifies the strict base64 decoder rejects lenient/garbage payloads and the
 * magic-byte check ties the declared MIME to the actual decoded bytes, so a
 * text blob cannot be accepted as `image/png`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { NanoInvalidInputError } from "@sunpcm/niu-feature-nano";
import { decodeBase64Strict, validateImageBytes } from "@/lib/nano/validate";

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("strict base64 accepts canonical padded/unpadded and rejects garbage", () => {
  assert.equal(decodeBase64Strict("aGVsbG8=").toString("utf8"), "hello");
  assert.equal(decodeBase64Strict("aGVsbG8").toString("utf8"), "hello");
  assert.throws(() => decodeBase64Strict("hello world!"), NanoInvalidInputError);
  assert.throws(() => decodeBase64Strict("aGVsbG8!!!"), NanoInvalidInputError);
});

test("magic-byte check rejects a text blob declared as image/png", () => {
  assert.throws(() => validateImageBytes(Buffer.from("hello"), "image/png"), NanoInvalidInputError);
});

test("magic-byte check accepts real PNG bytes and rejects mismatched MIME", () => {
  validateImageBytes(VALID_PNG, "image/png");
  assert.throws(() => validateImageBytes(VALID_PNG, "image/jpeg"), NanoInvalidInputError);
  assert.throws(() => validateImageBytes(VALID_PNG, "image/webp"), NanoInvalidInputError);
});

test("empty image bytes are rejected", () => {
  assert.throws(() => validateImageBytes(Buffer.alloc(0), "image/png"), NanoInvalidInputError);
});
