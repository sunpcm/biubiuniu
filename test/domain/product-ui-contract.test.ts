/** Pure, IO-free product regressions collected by the root `test:domain` glob. */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertPublicNanoConfig,
  isStableCaseId,
  nanoInputFingerprint,
  nanoResultImageSource,
  validateNanoInput,
} from "@/components/nano/contract";
import type { NanoPublicConfig, NanoResultImage } from "@/components/nano/types";
import { legacyPricingPlans } from "@/config/legacy-pricing";
import { nanoCases } from "@/config/nano-cases";

const publicConfig: NanoPublicConfig = {
  enabled: false,
  cost: 1,
  maxPromptChars: 4000,
  maxImageBytes: 5 * 1024 * 1024,
  allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
};

test("product: 47 stable cases keep their source IDs, order and asset references", () => {
  assert.equal(nanoCases.length, 47);
  assert.equal(nanoCases[0].id, "case1");
  assert.equal(nanoCases[46].id, "case47");
  assert.equal(new Set(nanoCases.map((item) => item.id)).size, 47);
  for (const item of nanoCases) {
    assert.equal(isStableCaseId(item.id), true, `unstable case ${item.id}`);
  }

  const assets = nanoCases.flatMap((item) => [
    ...item.inputImages,
    ...item.outputImages,
  ]);
  assert.equal(assets.length, 88);
  assert.ok(assets.every((asset) => asset.startsWith("/examples/images/")));
  assert.equal(nanoCases.filter((item) => item.inputImages.length === 0).length, 10);
  assert.equal(nanoCases.filter((item) => item.outputImages.length === 0).length, 8);
  assert.equal(isStableCaseId("case48"), false);
});

test("product: seven legacy plans remain test-only and preserve benefit keys", () => {
  assert.equal(legacyPricingPlans.length, 7);
  assert.ok(legacyPricingPlans.every((plan) => plan.environment === "test"));
  assert.deepEqual(
    legacyPricingPlans.reduce<Record<string, number>>((counts, plan) => {
      counts[plan.provider] = (counts[plan.provider] ?? 0) + 1;
      return counts;
    }, {}),
    { stripe: 4, creem: 2, none: 1 },
  );

  const allowedBenefitKeys = new Set([
    "monthlyCredits",
    "oneTimeCredits",
    "totalMonths",
  ]);
  for (const plan of legacyPricingPlans) {
    assert.ok(plan.localized.en && plan.localized.zh && plan.localized.ja);
    assert.ok(
      Object.keys(plan.benefits).every((key) => allowedBenefitKeys.has(key)),
      `unexpected benefit key in ${plan.id}`,
    );
  }
  const noPayment = legacyPricingPlans.find((plan) => plan.provider === "none");
  assert.equal(noPayment?.paymentType, null);
});

test("product: Nano input validation uses server-owned limits and the case allowlist", () => {
  const valid = {
    prompt: "draw a figure",
    mimeType: "image/png",
    imageBytes: 2048,
    caseId: "case1",
  };
  assert.equal(validateNanoInput(valid, publicConfig), null);
  assert.equal(
    validateNanoInput({ ...valid, prompt: "   " }, publicConfig),
    "INVALID_INPUT",
  );
  assert.equal(
    validateNanoInput(
      { ...valid, prompt: "x".repeat(publicConfig.maxPromptChars + 1) },
      publicConfig,
    ),
    "INVALID_INPUT",
  );
  assert.equal(
    validateNanoInput({ ...valid, mimeType: "image/gif" }, publicConfig),
    "INVALID_INPUT",
  );
  assert.equal(
    validateNanoInput({ ...valid, imageBytes: 0 }, publicConfig),
    "INVALID_INPUT",
  );
  assert.equal(
    validateNanoInput(
      { ...valid, imageBytes: publicConfig.maxImageBytes + 1 },
      publicConfig,
    ),
    "INVALID_INPUT",
  );
  assert.equal(
    validateNanoInput({ ...valid, caseId: "case48" }, publicConfig),
    "UNKNOWN_CASE",
  );
});

test("product: replay fingerprints and result image URLs stay deterministic", () => {
  const first = {
    prompt: "hello",
    image: "QUJD",
    mimeType: "image/png",
    caseId: "case1",
  };
  assert.equal(nanoInputFingerprint(first), nanoInputFingerprint({ ...first }));
  assert.notEqual(
    nanoInputFingerprint(first),
    nanoInputFingerprint({ ...first, prompt: "hello!" }),
  );

  const inline: NanoResultImage = {
    kind: "inline",
    mimeType: "image/png",
    dataBase64: "QUJD",
  };
  const authorizedObject: NanoResultImage = {
    kind: "object",
    url: "/api/nano/tasks/task-1/result/0",
  };
  const externalObject: NanoResultImage = {
    kind: "object",
    url: "https://cdn.example.invalid/object-key",
  };
  assert.equal(
    nanoResultImageSource(inline),
    "data:image/png;base64,QUJD",
  );
  assert.equal(
    nanoResultImageSource(authorizedObject),
    "/api/nano/tasks/task-1/result/0",
  );
  assert.equal(nanoResultImageSource(externalObject), null);
});

test("product: public Nano config rejects server-only fields", () => {
  assert.deepEqual(assertPublicNanoConfig(publicConfig), publicConfig);
  for (const forbiddenKey of ["apiKey", "model", "provider", "raw"] as const) {
    const leaked = {
      ...publicConfig,
      [forbiddenKey]: "server-only",
    } as unknown as NanoPublicConfig;
    assert.throws(
      () => assertPublicNanoConfig(leaked),
      new RegExp(`Nano public config leaked ${forbiddenKey}`),
    );
  }
});
