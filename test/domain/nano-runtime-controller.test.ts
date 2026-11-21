/**
 * In-process Nano runtime controller: shutdown lease gate, per-step isolation,
 * unknown observability, and the unknown-expiry step. No database and no real
 * provider: the coordinator is a recording in-memory double.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { NanoProviderError, type NanoProvider, type NanoTask } from "@sunpcm/niu-feature-nano";
import type { NanoCoordinator } from "@sunpcm/niu-persistence-pg/nano";
import { createNanoRuntimeController } from "@/lib/nano/runtime";

function queuedTask(id: string): NanoTask {
  const now = new Date();
  return {
    id,
    productId: "p",
    subjectKey: "user:u",
    subject: { userId: "u", organizationId: null },
    feature: "nano-image",
    requestKey: id,
    contentSummary: id,
    inputRef: { prompt: "p", imageData: null, mimeType: null },
    status: "queued",
    cost: 1,
    spendTxId: "tx",
    providerRequestKey: null,
    providerTaskId: null,
    resultRef: null,
    resultSummary: null,
    leaseOwner: null,
    leaseToken: null,
    leaseUntil: null,
    createdAt: now,
    updatedAt: now,
  };
}

interface Double {
  coordinator: NanoCoordinator;
  calls: string[];
  leased: string[];
}

function makeCoordinator(overrides: Partial<NanoCoordinator> = {}, queue: NanoTask[] = []): Double {
  const calls: string[] = [];
  const leased: string[] = [];
  const base = {
    async listDispatchable() {
      calls.push("listDispatchable");
      return queue;
    },
    async listStaged() {
      calls.push("listStaged");
      return [];
    },
    async listStaleInFlight() {
      calls.push("listStaleInFlight");
      return [];
    },
    async listExpiredUnknown() {
      calls.push("listExpiredUnknown");
      return [];
    },
    async markLeased(id: string) {
      leased.push(id);
      return { ...queuedTask(id), status: "leased" as const };
    },
    async markDispatching(id: string) {
      return { ...queuedTask(id), status: "dispatching" as const };
    },
    async markUnknown(id: string) {
      return { ...queuedTask(id), status: "unknown" as const };
    },
    async stageResult(id: string) {
      return { ...queuedTask(id), status: "dispatching" as const };
    },
    async complete(id: string) {
      return { ...queuedTask(id), status: "succeeded" as const };
    },
    async fail(id: string) {
      return { ...queuedTask(id), status: "failed" as const };
    },
    async get() {
      return null;
    },
  };
  const coordinator = { ...base, ...overrides } as unknown as NanoCoordinator;
  return { coordinator, calls, leased };
}

function recordingLogger() {
  const entries: Array<Record<string, unknown>> = [];
  return {
    entries,
    logger: {
      warn: (payload: unknown) => {
        entries.push(payload as Record<string, unknown>);
      },
    } as never,
  };
}

const okProvider: NanoProvider = {
  async generate() {
    return { images: [{ dataBase64: "AA==", mimeType: "image/png" }], text: null };
  },
};

function controllerOptions(double: Double, provider: NanoProvider | null, logger: never) {
  return {
    coordinator: double.coordinator,
    provider,
    model: "m",
    leaseMs: 60_000,
    batchSize: 10,
    maxConcurrent: 1,
    pollIntervalMs: 60_000,
    unknownRefundAfterMs: 600_000,
    logger,
  };
}

test("stop() closes the lease gate: the running sweep leases nothing new", async () => {
  const double = makeCoordinator({}, [queuedTask("t1"), queuedTask("t2"), queuedTask("t3")]);
  const { logger } = recordingLogger();
  let controller: ReturnType<typeof createNanoRuntimeController>;
  const provider: NanoProvider = {
    async generate() {
      controller.stop();
      return { images: [{ dataBase64: "AA==", mimeType: "image/png" }], text: null };
    },
  };
  controller = createNanoRuntimeController(controllerOptions(double, provider, logger));

  await controller.runOnce();
  assert.deepEqual(double.leased, ["t1"]);
  assert.equal(controller.isRunning(), false);

  // The gate stays closed for later manual sweeps until start() reopens it.
  await controller.runOnce();
  assert.deepEqual(double.leased, ["t1"]);
  // Recovery steps still ran while stopping.
  assert.ok(double.calls.includes("listStaged"));
  assert.ok(double.calls.includes("listExpiredUnknown"));
});

test("a failing step does not skip the recovery steps after it", async () => {
  const calls: string[] = [];
  const double = makeCoordinator({
    async listDispatchable() {
      calls.push("listDispatchable");
      throw new Error("database is down: secret-connection-string");
    },
  });
  const { logger, entries } = recordingLogger();
  const controller = createNanoRuntimeController(controllerOptions(double, okProvider, logger));

  await controller.runOnce();
  assert.deepEqual(double.calls, ["listStaged", "listStaleInFlight", "listExpiredUnknown"]);
  assert.deepEqual(
    entries.map((e) => [e.code, e.step]),
    [["nano_sweep_failed", "dispatch"]],
  );
  assert.doesNotMatch(JSON.stringify(entries), /secret-connection-string/);
});

test("an uncertain provider failure is logged with a stable code and the task id only", async () => {
  const double = makeCoordinator({}, [queuedTask("t-unknown")]);
  const { logger, entries } = recordingLogger();
  const provider: NanoProvider = {
    async generate() {
      throw new NanoProviderError("raw provider detail", { unknown: true });
    },
  };
  const controller = createNanoRuntimeController(controllerOptions(double, provider, logger));

  await controller.runOnce();
  const unknown = entries.filter((e) => e.code === "nano_task_unknown");
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].taskId, "t-unknown");
  assert.equal(unknown[0].reason, "provider");
  assert.doesNotMatch(JSON.stringify(entries), /raw provider detail/);
});

test("expired unknown tasks are refunded and logged; the step is skipped without a threshold", async () => {
  const expired: Array<[string, number]> = [];
  const double = makeCoordinator({
    async listExpiredUnknown(enteredBefore: Date) {
      expired.push(["list", Date.now() - enteredBefore.getTime()]);
      return ["u1", "u2"];
    },
    async expireUnknown(id: string) {
      return { task: { ...queuedTask(id), status: "failed" as const }, refunded: id === "u1" };
    },
  } as Partial<NanoCoordinator>);
  const { logger, entries } = recordingLogger();
  const controller = createNanoRuntimeController(controllerOptions(double, null, logger));

  await controller.runOnce();
  assert.equal(expired.length, 1);
  assert.ok(Math.abs(expired[0][1] - 600_000) < 5_000, "cutoff is now - unknownRefundAfterMs");
  const refunded = entries.filter((e) => e.code === "nano_unknown_refunded");
  assert.deepEqual(
    refunded.map((e) => [e.taskId, e.cost]),
    [["u1", 1]],
  );

  const quiet = makeCoordinator();
  const disabled = createNanoRuntimeController({
    ...controllerOptions(quiet, null, logger),
    unknownRefundAfterMs: undefined,
  });
  await disabled.runOnce();
  assert.deepEqual(quiet.calls, ["listStaged", "listStaleInFlight"]);
});
