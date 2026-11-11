/**
 * The product id is a persisted identifier, not the brand name. It is stored in
 * `nano_tasks.product_id` and filters every Nano read and sweep, so it must keep
 * its historical value even if `siteConfig.name` is ever changed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PRODUCT_ID } from "@/config/product";

test("PRODUCT_ID keeps the historical persisted value", () => {
  assert.equal(PRODUCT_ID, "BiuBiuNiu");
});

test("commerce composition defaults to PRODUCT_ID, not the display name", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../apps/web/src/composition/commerce.ts", import.meta.url)),
    "utf8",
  );
  assert.match(source, /productId:\s*options\.productId\s*\?\?\s*PRODUCT_ID\b/);
  assert.doesNotMatch(source, /productId:[^\n]*siteConfig\.name/);
});
