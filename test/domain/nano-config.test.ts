/**
 * Nano server configuration bounds and the lease/timeout relationship guard.
 *
 * These tests call the real `getNanoServerConfig` entry point so they verify
 * the production `boundedInt` clamp/fallback behavior and the normalized
 * `leaseMs > providerTimeoutMs` invariant rather than a copied helper.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { getNanoServerConfig } from "@/config/nano";

const NANO_ENV_KEYS = [
  "NANO_MODEL",
  "NANO_PROVIDER_TIMEOUT_MS",
  "NANO_LEASE_MS",
  "NANO_MAX_CONCURRENT_DISPATCHES",
  "NANO_DISPATCH_BATCH_SIZE",
  "NANO_POLL_INTERVAL_MS",
  "NANO_UNKNOWN_REFUND_AFTER_MS",
] as const;

function withNanoEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void,
): void {
  const previous = new Map<string, string | undefined>();
  for (const key of NANO_ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  try {
    for (const [key, value] of Object.entries(overrides)) {
      assert.ok(
        (NANO_ENV_KEYS as readonly string[]).includes(key),
        `test override must only touch a Nano config env var: ${key}`,
      );
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fn();
  } finally {
    for (const key of NANO_ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function assertLeaseTimeoutError(
  fn: () => void,
  expectedLeaseMs: number,
  expectedTimeoutMs: number,
): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof Error, "must throw an Error");
    assert.match(error.message, /NANO_LEASE_MS/);
    assert.match(error.message, /NANO_PROVIDER_TIMEOUT_MS/);
    assert.ok(
      error.message.includes(String(expectedLeaseMs)),
      `message must include normalized lease ${expectedLeaseMs}: ${error.message}`,
    );
    assert.ok(
      error.message.includes(String(expectedTimeoutMs)),
      `message must include normalized timeout ${expectedTimeoutMs}: ${error.message}`,
    );
    return true;
  });
}

test("defaults keep the safe 120000/180000 lease-above-timeout relationship", () => {
  withNanoEnv({}, () => {
    const config = getNanoServerConfig();
    assert.equal(config.providerTimeoutMs, 120_000);
    assert.equal(config.leaseMs, 180_000);
    assert.equal(config.model, "gemini-2.5-flash-image-preview");
    assert.equal(config.cost, 1);
    assert.equal(config.maxImageBytes, 5 * 1024 * 1024);
    assert.equal(config.maxPromptLength, 4000);
    assert.equal(config.maxConcurrentDispatches, 4);
    assert.equal(config.dispatchBatchSize, 10);
    assert.equal(config.pollIntervalMs, 5_000);
    assert.equal(config.unknownRefundAfterMs, 900_000);
  });
});

test("explicit valid values are respected", () => {
  withNanoEnv(
    { NANO_PROVIDER_TIMEOUT_MS: "30000", NANO_LEASE_MS: "240000" },
    () => {
      const config = getNanoServerConfig();
      assert.equal(config.providerTimeoutMs, 30_000);
      assert.equal(config.leaseMs, 240_000);
    },
  );
});

test("equal lease and timeout is rejected with normalized values", () => {
  withNanoEnv(
    { NANO_PROVIDER_TIMEOUT_MS: "120000", NANO_LEASE_MS: "120000" },
    () => {
      assertLeaseTimeoutError(() => getNanoServerConfig(), 120_000, 120_000);
    },
  );
});

test("reversed lease below timeout is rejected with normalized values", () => {
  withNanoEnv(
    { NANO_PROVIDER_TIMEOUT_MS: "600000", NANO_LEASE_MS: "30000" },
    () => {
      assertLeaseTimeoutError(() => getNanoServerConfig(), 30_000, 600_000);
    },
  );
});

test("minimum timeout and maximum lease form a valid boundary", () => {
  withNanoEnv(
    { NANO_PROVIDER_TIMEOUT_MS: "1000", NANO_LEASE_MS: "3600000" },
    () => {
      const config = getNanoServerConfig();
      assert.equal(config.providerTimeoutMs, 1_000);
      assert.equal(config.leaseMs, 3_600_000);
    },
  );
});

test("equal values at the minimum lease boundary are rejected", () => {
  withNanoEnv(
    { NANO_PROVIDER_TIMEOUT_MS: "30000", NANO_LEASE_MS: "30000" },
    () => {
      assertLeaseTimeoutError(() => getNanoServerConfig(), 30_000, 30_000);
    },
  );
});

test("out-of-range values are clamped without breaking the relationship", () => {
  withNanoEnv(
    { NANO_PROVIDER_TIMEOUT_MS: "0", NANO_LEASE_MS: "9999999" },
    () => {
      const config = getNanoServerConfig();
      assert.equal(config.providerTimeoutMs, 1_000);
      assert.equal(config.leaseMs, 3_600_000);
    },
  );
});

test("non-numeric values fall back to the safe defaults", () => {
  withNanoEnv(
    { NANO_PROVIDER_TIMEOUT_MS: "garbage", NANO_LEASE_MS: "not-a-number" },
    () => {
      const config = getNanoServerConfig();
      assert.equal(config.providerTimeoutMs, 120_000);
      assert.equal(config.leaseMs, 180_000);
    },
  );
});

test("mixed clamp and fallback normalize to a valid relationship", () => {
  withNanoEnv(
    { NANO_PROVIDER_TIMEOUT_MS: "0", NANO_LEASE_MS: "nope" },
    () => {
      const config = getNanoServerConfig();
      assert.equal(config.providerTimeoutMs, 1_000);
      assert.equal(config.leaseMs, 180_000);
    },
  );
});

test("clamping can still surface a reversed relationship instead of hiding it", () => {
  withNanoEnv(
    { NANO_PROVIDER_TIMEOUT_MS: "999999", NANO_LEASE_MS: "10" },
    () => {
      assertLeaseTimeoutError(() => getNanoServerConfig(), 30_000, 600_000);
    },
  );
});

test("unknown refund threshold is configurable, clamped, and falls back safely", () => {
  withNanoEnv({ NANO_UNKNOWN_REFUND_AFTER_MS: "300000" }, () => {
    assert.equal(getNanoServerConfig().unknownRefundAfterMs, 300_000);
  });
  withNanoEnv({ NANO_UNKNOWN_REFUND_AFTER_MS: "1" }, () => {
    assert.equal(getNanoServerConfig().unknownRefundAfterMs, 60_000);
  });
  withNanoEnv({ NANO_UNKNOWN_REFUND_AFTER_MS: "999999999999" }, () => {
    assert.equal(getNanoServerConfig().unknownRefundAfterMs, 86_400_000);
  });
  withNanoEnv({ NANO_UNKNOWN_REFUND_AFTER_MS: "soon" }, () => {
    assert.equal(getNanoServerConfig().unknownRefundAfterMs, 900_000);
  });
});
