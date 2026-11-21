/**
 * Nano bootstrap phase gating and single-instance start (no-PG, no-network).
 *
 * Next 16 only writes `NEXT_PHASE=phase-production-build` into `process.env`
 * during `next build`; `next start`/`next dev` leave it unset. These tests lock
 * the bootstrap to start on a real server, skip build/static export, and never
 * assemble a second controller/timer/listener on repeated registration.
 */

import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { isNanoBootstrapPhase, startNanoRuntimeOnce } from "@/lib/nano/bootstrap";

let assemblyCount = 0;
let startCount = 0;

mock.module("@/composition/nano", {
  exports: {
    getNanoRuntime: async () => ({
      coordinator: { id: "stub-coordinator" },
      provider: null,
      config: {
        model: "gemini-stub",
        leaseMs: 120_000,
        dispatchBatchSize: 10,
        maxConcurrentDispatches: 2,
        pollIntervalMs: 5_000,
      },
    }),
  },
});

mock.module("@/lib/nano/runtime", {
  exports: {
    createNanoRuntimeController: () => {
      assemblyCount += 1;
      return {
        start: () => {
          startCount += 1;
        },
        stop: () => {},
        runOnce: async () => {},
        restart: () => {},
        isRunning: () => false,
      };
    },
  },
});

async function withPhase(
  phase: string | undefined,
  fn: () => void | Promise<void>,
): Promise<void> {
  const previous = process.env.NEXT_PHASE;
  if (phase === undefined) {
    delete process.env.NEXT_PHASE;
  } else {
    process.env.NEXT_PHASE = phase;
  }
  try {
    await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.NEXT_PHASE;
    } else {
      process.env.NEXT_PHASE = previous;
    }
  }
}

test("unset NEXT_PHASE is a real server bootstrap", () => {
  assert.equal(isNanoBootstrapPhase(undefined), true);
});

test("explicit server phases are bootstraps", () => {
  assert.equal(isNanoBootstrapPhase("phase-production-server"), true);
  assert.equal(isNanoBootstrapPhase("phase-development-server"), true);
});

test("build and static export phases never bootstrap", () => {
  assert.equal(isNanoBootstrapPhase("phase-production-build"), false);
  assert.equal(isNanoBootstrapPhase("phase-export"), false);
});

test("server bootstrap assembles and starts exactly once across repeated calls", async () => {
  await withPhase(undefined, async () => {
    await startNanoRuntimeOnce();
    await startNanoRuntimeOnce();
    await startNanoRuntimeOnce();
  });
  assert.equal(assemblyCount, 1);
  assert.equal(startCount, 1);
});

test("build phase never assembles or starts", async () => {
  const beforeAssembly = assemblyCount;
  const beforeStart = startCount;
  await withPhase("phase-production-build", async () => {
    await startNanoRuntimeOnce();
  });
  assert.equal(assemblyCount, beforeAssembly);
  assert.equal(startCount, beforeStart);
});
