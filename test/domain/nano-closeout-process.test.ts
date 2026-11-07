/**
 * Fresh-process Nano closeout recovery against real PostgreSQL.
 *
 * Each worker is a new Node process that invokes the production composition,
 * bootstrap and runtime controller once. PostgreSQL, coordinator, Commerce and
 * the Google SDK are real; only the SDK's documented global fetch transport is
 * replaced so success and timeout behavior stay deterministic.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { siteConfig } from "@/config/site";
import { closeDatabase, db } from "@/lib/db";
import { creditTransactions, nanoActiveJobs, nanoTasks, user as userTable } from "@/lib/db/schema";
import { serializeProviderResult } from "@/lib/nano/dto";
import { createNanoClaim } from "@/lib/nano/dispatch";
import { createNanoCoordinator, type NanoCoordinator } from "@sunpcm/niu-persistence-pg/nano";
import type { NanoClaim, NanoSubject, NanoTaskStatus } from "@sunpcm/niu-feature-nano";
import { migrate, resetSyntheticData } from "./helpers";
import { createDomainCommerce } from "./commerce-assembly";

const PRODUCT = siteConfig.name;
const SYNTHETIC_PROVIDER_KEY = "synthetic-closeout-process-key";
const WORKER_PATH = "test/fixtures/nano/closeout-worker.ts";
const WORKER_TIMEOUT_MS = 20_000;
const RECEIPT_PREFIX = "NANO_CLOSEOUT_RECEIPT\t";
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const NANO_TASK_STATUSES = new Set<NanoTaskStatus>([
  "queued",
  "leased",
  "dispatching",
  "running",
  "unknown",
  "succeeded",
  "failed",
  "canceled",
]);

type CloseoutMode = "success" | "timeout";

interface WatchTarget {
  taskId: string;
  status: NanoTaskStatus;
}

interface CloseoutCommand {
  launch: string;
  mode: CloseoutMode;
  counterFile: string;
  eventsFile: string;
  watch: WatchTarget[];
}

interface CloseoutReceipt {
  launch: string;
  productId: string;
  enabled: boolean;
  publicEnabled: boolean;
  provider: boolean;
  statuses: Record<string, NanoTaskStatus>;
  sdkCalls: number;
  abortSignals: number;
}

interface WorkerRun {
  code: number | null;
  signal: NodeJS.Signals | null;
  pid: number | undefined;
  receipt: CloseoutReceipt;
  sdkCalls: number;
  abortSignals: number;
}

interface WorkerOptions {
  disabled: boolean;
  withKey: boolean;
}

const domain = createDomainCommerce({ productId: PRODUCT });
const coordinator: NanoCoordinator = createNanoCoordinator({
  db,
  store: domain.app.store,
  commerce: domain.app.commerce,
  productId: PRODUCT,
});
const workerLaunches = new Set<string>();
const childPids = new Set<number>();

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@example.invalid`;
}

async function createUser(prefix: string): Promise<string> {
  const [row] = await db
    .insert(userTable)
    .values({ email: uniqueEmail(prefix) })
    .returning({ id: userTable.id });
  return row.id;
}

function admitInput(userId: string, requestKey: string) {
  return {
    productId: PRODUCT,
    subject: { userId, organizationId: null } as NanoSubject,
    actorUserId: userId,
    feature: "nano-image",
    requestKey,
    contentSummary: `summary:${requestKey}`,
    cost: 1,
    inputRef: {
      prompt: `closeout:${requestKey}`,
      imageData: PNG_BASE64,
      mimeType: "image/png",
    },
  };
}

async function admit(userId: string, requestKey: string) {
  const result = await coordinator.admit(admitInput(userId, requestKey));
  assert.equal(result.created, true);
  return result.task;
}

async function claimExpiredTask(taskId: string, requestKey: string): Promise<NanoClaim> {
  const claim = createNanoClaim("closeout-test-seed");
  const leased = await coordinator.markLeased(taskId, claim, new Date(Date.now() - 1_000));
  assert.ok(leased);
  const dispatching = await coordinator.markDispatching(taskId, requestKey, claim);
  assert.ok(dispatching);
  return claim;
}

function lateResult() {
  return serializeProviderResult({
    images: [{ mimeType: "image/png", dataBase64: PNG_BASE64 }],
    text: null,
  });
}

async function assertCreditsAndLedger(
  userId: string,
  expectedPurchased: number,
  expectedUsage: number,
  expectedRefunds: number,
): Promise<void> {
  const credits = await domain.credits.getUserCredits(userId);
  assert.equal(credits.subscriptionCredits, 0);
  assert.equal(credits.purchasedCredits, expectedPurchased);
  assert.equal(credits.totalCredits, expectedPurchased);

  const entries = await db
    .select({ type: creditTransactions.type })
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId));
  assert.equal(entries.filter((entry) => entry.type === "usage").length, expectedUsage);
  assert.equal(entries.filter((entry) => entry.type === "usage_refund").length, expectedRefunds);
}

function parseReceipt(stdout: string, launch: string): CloseoutReceipt {
  const framedLines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(RECEIPT_PREFIX));
  assert.equal(framedLines.length, 1, "worker must emit exactly one receipt frame");

  const receipt = JSON.parse(framedLines[0].slice(RECEIPT_PREFIX.length)) as unknown;
  assertReceiptShape(receipt);
  assert.equal(receipt.launch, launch);
  return receipt;
}

function assertReceiptShape(value: unknown): asserts value is CloseoutReceipt {
  assert.ok(isRecord(value), "receipt frame must contain an object");
  assert.deepEqual(Object.keys(value).sort(), [
    "abortSignals",
    "enabled",
    "launch",
    "productId",
    "provider",
    "publicEnabled",
    "sdkCalls",
    "statuses",
  ]);
  const launch = value.launch;
  assert.ok(typeof launch === "string" && launch.length > 0);
  const productId = value.productId;
  assert.ok(typeof productId === "string" && productId.length > 0);
  assert.equal(typeof value.enabled, "boolean");
  assert.equal(typeof value.publicEnabled, "boolean");
  assert.equal(typeof value.provider, "boolean");
  const sdkCalls = value.sdkCalls;
  assert.ok(typeof sdkCalls === "number" && Number.isSafeInteger(sdkCalls) && sdkCalls >= 0);
  const abortSignals = value.abortSignals;
  assert.ok(
    typeof abortSignals === "number" && Number.isSafeInteger(abortSignals) && abortSignals >= 0,
  );
  const statuses = value.statuses;
  assert.ok(isRecord(statuses), "receipt statuses must be an object");
  for (const [taskId, status] of Object.entries(statuses)) {
    assert.ok(taskId.length > 0);
    assert.ok(
      typeof status === "string" && NANO_TASK_STATUSES.has(status as NanoTaskStatus),
      `receipt contains invalid task status: ${String(status)}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runWorker(
  mode: CloseoutMode,
  watch: WatchTarget[],
  options: WorkerOptions,
): Promise<WorkerRun> {
  const scratch = mkdtempSync(join(tmpdir(), "nano-closeout-process-"));
  const counterFile = join(scratch, "sdk-calls.txt");
  const eventsFile = join(scratch, "transport-events.jsonl");
  writeFileSync(counterFile, "0");
  writeFileSync(eventsFile, "");

  const launch = randomUUID();
  const command: CloseoutCommand = {
    launch,
    mode,
    counterFile,
    eventsFile,
    watch,
  };
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TSX_TSCONFIG_PATH: "test/domain/tsconfig.json",
    HUSKY: "0",
    DISABLE_NANO: options.disabled ? "true" : "false",
    GOOGLE_GENERATIVE_AI_API_KEY: options.withKey ? SYNTHETIC_PROVIDER_KEY : "",
    NANO_MODEL: "gemini",
    NANO_PROVIDER_TIMEOUT_MS: "1000",
    NANO_POLL_INTERVAL_MS: "1000",
    NANO_LEASE_MS: "30000",
    NANO_MAX_CONCURRENT_DISPATCHES: "1",
    NANO_DISPATCH_BATCH_SIZE: "10",
  };
  delete env.NEXT_PHASE;

  const child = spawn(process.execPath, ["--import", "tsx", WORKER_PATH], {
    cwd: process.cwd(),
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

  return new Promise<WorkerRun>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, WORKER_TIMEOUT_MS);

    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rmSync(scratch, { recursive: true, force: true });
    };

    child.once("error", (error) => {
      finish();
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      const output = Buffer.concat(stdout).toString("utf8");
      const errors = Buffer.concat(stderr).toString("utf8");
      if (timedOut) {
        finish();
        reject(
          new Error(`closeout worker exceeded ${WORKER_TIMEOUT_MS}ms and was reaped\n${errors}`),
        );
        return;
      }
      if (code !== 0) {
        finish();
        reject(
          new Error(
            `closeout worker exited with code ${code} signal ${signal}\nstdout:\n${output}\nstderr:\n${errors}`,
          ),
        );
        return;
      }
      try {
        const pid = child.pid;
        assert.ok(pid !== undefined && pid > 0, "worker must have a real pid");
        const receipt = parseReceipt(output, launch);
        assert.deepEqual(
          receipt.statuses,
          Object.fromEntries(watch.map(({ taskId, status }) => [taskId, status])),
        );
        const sdkCalls = Number.parseInt(readFileSync(counterFile, "utf8").trim() || "0", 10);
        const eventLines = readFileSync(eventsFile, "utf8").split("\n").filter(Boolean);
        const abortSignals = eventLines.filter((line) => {
          const event = JSON.parse(line) as { event?: unknown };
          return event.event === "sdk-abort-signal";
        }).length;
        finish();
        resolve({
          code,
          signal,
          pid,
          receipt,
          sdkCalls,
          abortSignals,
        });
      } catch (error) {
        finish();
        reject(error);
      }
    });

    child.stdin.end(JSON.stringify(command));
  });
}

function assertFreshWorker(run: WorkerRun, launchLabel: string): void {
  assert.equal(run.code, 0);
  assert.equal(run.signal, null);
  assert.equal(run.receipt.productId, PRODUCT);
  assert.ok(run.pid !== undefined && run.pid > 0);
  assert.notEqual(run.pid, process.pid);
  assert.equal(childPids.has(run.pid), false, `${launchLabel}: pid was reused`);
  assert.equal(workerLaunches.has(run.receipt.launch), false);
  childPids.add(run.pid);
  workerLaunches.add(run.receipt.launch);
}

async function statusOf(taskId: string): Promise<NanoTaskStatus | undefined> {
  const task = await coordinator.get(taskId);
  return task?.status;
}

before(async () => {
  await migrate();
});

after(async () => {
  await closeDatabase();
});

test("fresh-process closeout dispatch and recovery preserve durable state", async (t) => {
  await t.test("disabled with a key dispatches one old queued task", async () => {
    await resetSyntheticData();
    const userId = await createUser("nano-closeout-key");
    await domain.ledger.grantPurchasedCredits({
      userId,
      amount: 2,
      note: "seed",
    });
    const queued = await admit(userId, "key-queued");

    const run = await runWorker("success", [{ taskId: queued.id, status: "succeeded" }], {
      disabled: true,
      withKey: true,
    });
    assertFreshWorker(run, "disabled-key");
    assert.equal(run.receipt.enabled, false);
    assert.equal(run.receipt.publicEnabled, false);
    assert.equal(run.receipt.provider, true);
    assert.equal(run.receipt.sdkCalls, 1);
    assert.equal(run.sdkCalls, 1);
    assert.equal(await statusOf(queued.id), "succeeded");
    await assertCreditsAndLedger(userId, 1, 1, 0);

    const [activeJob] = await db
      .select()
      .from(nanoActiveJobs)
      .where(eq(nanoActiveJobs.taskId, queued.id));
    assert.equal(activeJob, undefined);
  });

  await t.test(
    "disabled without a key finalizes staged and stale but leaves queued unsent",
    async () => {
      await resetSyntheticData();
      const userId = await createUser("nano-closeout-no-key");
      await domain.ledger.grantPurchasedCredits({
        userId,
        amount: 5,
        note: "seed",
      });

      const staged = await admit(userId, "no-key-staged");
      const stagedClaim = await claimExpiredTask(staged.id, "no-key-staged");
      const result = lateResult();
      const stagedResult = await coordinator.stageResult(
        staged.id,
        result.resultRef,
        result.resultSummary,
        stagedClaim,
      );
      assert.ok(stagedResult);

      const stale = await admit(userId, "no-key-stale");
      await claimExpiredTask(stale.id, "no-key-stale");

      const queued = await admit(userId, "no-key-queued");
      const run = await runWorker(
        "success",
        [
          { taskId: staged.id, status: "succeeded" },
          { taskId: stale.id, status: "unknown" },
          { taskId: queued.id, status: "queued" },
        ],
        { disabled: true, withKey: false },
      );
      assertFreshWorker(run, "disabled-no-key");
      assert.equal(run.receipt.enabled, false);
      assert.equal(run.receipt.publicEnabled, false);
      assert.equal(run.receipt.provider, false);
      assert.equal(run.receipt.sdkCalls, 0);
      assert.equal(run.sdkCalls, 0);
      assert.equal(await statusOf(staged.id), "succeeded");
      assert.equal(await statusOf(stale.id), "unknown");
      assert.equal(await statusOf(queued.id), "queued");
      await assertCreditsAndLedger(userId, 2, 3, 0);
    },
  );

  await t.test("SDK timeout becomes unknown and a late staged result recovers once", async () => {
    await resetSyntheticData();
    const userId = await createUser("nano-closeout-timeout");
    await domain.ledger.grantPurchasedCredits({
      userId,
      amount: 2,
      note: "seed",
    });
    const queued = await admit(userId, "timeout-queued");

    const timeoutRun = await runWorker("timeout", [{ taskId: queued.id, status: "unknown" }], {
      disabled: false,
      withKey: true,
    });
    assertFreshWorker(timeoutRun, "sdk-timeout");
    assert.equal(timeoutRun.receipt.enabled, true);
    assert.equal(timeoutRun.receipt.publicEnabled, true);
    assert.equal(timeoutRun.receipt.provider, true);
    assert.equal(timeoutRun.receipt.sdkCalls, 1);
    assert.equal(timeoutRun.sdkCalls, 1);
    assert.equal(timeoutRun.receipt.abortSignals, 1);
    assert.equal(timeoutRun.abortSignals, 1);
    assert.equal(await statusOf(queued.id), "unknown");
    await assertCreditsAndLedger(userId, 1, 1, 0);

    const timedOutTask = await coordinator.get(queued.id);
    const leaseOwner = timedOutTask?.leaseOwner;
    const leaseToken = timedOutTask?.leaseToken;
    assert.ok(leaseOwner);
    assert.ok(leaseToken);
    const result = lateResult();
    const staged = await coordinator.stageResult(
      queued.id,
      result.resultRef,
      result.resultSummary,
      { leaseOwner, leaseToken },
    );
    assert.ok(staged);
    await db
      .update(nanoTasks)
      .set({ leaseUntil: new Date(Date.now() - 1_000) })
      .where(eq(nanoTasks.id, queued.id));

    const recovery = await runWorker("success", [{ taskId: queued.id, status: "succeeded" }], {
      disabled: true,
      withKey: true,
    });
    assertFreshWorker(recovery, "late-result");
    assert.equal(recovery.receipt.provider, true);
    assert.equal(recovery.sdkCalls, 0);
    assert.equal(await statusOf(queued.id), "succeeded");
    await assertCreditsAndLedger(userId, 1, 1, 0);

    const duplicate = await runWorker("success", [{ taskId: queued.id, status: "succeeded" }], {
      disabled: true,
      withKey: true,
    });
    assertFreshWorker(duplicate, "duplicate-recovery");
    assert.equal(duplicate.receipt.provider, true);
    assert.equal(duplicate.sdkCalls, 0);
    assert.equal(await statusOf(queued.id), "succeeded");
    await assertCreditsAndLedger(userId, 1, 1, 0);
  });
});
