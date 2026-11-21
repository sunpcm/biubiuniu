/**
 * Nano crash/restart fixtures (plan §5.4 five cut points).
 *
 * Controller-run against real PostgreSQL. Each phase spawns a fresh worker
 * process that kills itself with a real `SIGKILL` at the requested cut point,
 * so any in-memory task map or scheduler would be absent from the child. The
 * child's remote-accepted phases use the real Google GenAI SDK with an
 * in-memory transport (`GoogleMemoryTransportProvider`) so the accepted count is
 * an actual SDK HTTP invocation; the parent then runs the real recovery sweeps
 * (the dispatch sweep uses a zero-network port-level `CountingNanoProvider`) and
 * asserts durable state plus exact provider transport counts.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { and, eq } from "drizzle-orm";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { closeDatabase, db } from "@/lib/db";
import { nanoActiveJobs, nanoTasks, user as userTable } from "@/lib/db/schema";
import { createNanoCoordinator, type NanoCoordinator } from "@sunpcm/niu-persistence-pg/nano";
import { migrate, resetSyntheticData } from "./helpers";
import { createDomainCommerce } from "./commerce-assembly";
import { CountingNanoProvider } from "../fixtures/nano/counting-provider";
import {
  sweepDispatchable,
  sweepStaged,
  sweepStaleInFlight,
  type NanoDispatchConfig,
} from "@/lib/nano/dispatch";

const PRODUCT = "nexty_overnight_nano";
const workerLaunches = new Set<number>();
let workerLaunchCount = 0;

const domain = createDomainCommerce({ productId: PRODUCT });
const coordinator: NanoCoordinator = createNanoCoordinator({
  db,
  store: domain.app.store,
  commerce: domain.app.commerce,
  productId: PRODUCT,
});

function uniqueEmail(prefix: string) {
  return `${prefix}-${randomUUID()}@example.invalid`;
}

async function createUser(prefix: string) {
  const [row] = await db
    .insert(userTable)
    .values({ email: uniqueEmail(prefix) })
    .returning({ id: userTable.id });
  return row.id;
}

function createCounterFile(): string {
  const path = join(tmpdir(), `nano-counter-${randomUUID()}.txt`);
  writeFileSync(path, "0");
  return path;
}

function readCount(counterFile: string): number {
  const value = Number.parseInt(readFileSync(counterFile, "utf8").trim() || "0", 10);
  return Number.isFinite(value) ? value : 0;
}

interface WorkerRun {
  code: number | null;
  signal: string | null;
  pid: number | undefined;
  launch: number;
}

async function assertExactCredits(userId: string, expectedPurchased: number) {
  const credits = await domain.credits.getUserCredits(userId);
  assert.equal(credits.subscriptionCredits, 0);
  assert.equal(credits.purchasedCredits, expectedPurchased);
  assert.equal(credits.totalCredits, expectedPurchased);
}

function assertFreshSigkill(run: WorkerRun, phase: string): void {
  const pid = run.pid;
  assert.ok(pid !== undefined && pid > 0, `${phase}: expected a real child process`);
  assert.notEqual(pid, process.pid, `${phase}: child process must differ from the test runner`);
  assert.equal(workerLaunches.has(run.launch), false, `${phase}: each cut point needs a fresh process`);
  workerLaunches.add(run.launch);
  assert.equal(run.code, null, `${phase}: SIGKILL must not produce a normal exit code`);
  assert.equal(run.signal, "SIGKILL", `${phase}: child process must be killed by SIGKILL`);
}

function runWorker(phase: string, userId: string, requestKey: string, counterFile: string) {
  const launch = ++workerLaunchCount;
  return new Promise<WorkerRun>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "test/fixtures/nano/crash-worker.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TSX_TSCONFIG_PATH: "test/domain/tsconfig.json",
          NANO_PHASE: phase,
          NANO_USER_ID: userId,
          NANO_REQUEST_KEY: requestKey,
          NANO_COUNTER_FILE: counterFile,
        },
      },
    );
    child.on("error", reject);
    child.on("close", (code, signal) =>
      resolve({ code, signal, pid: child.pid, launch }),
    );
  });
}

const dispatchConfig: NanoDispatchConfig = {
  owner: "restart-sweep",
  leaseMs: 120_000,
  model: "gemini",
  batchSize: 10,
  maxConcurrent: 2,
};

before(async () => {
  await migrate();
});

after(async () => {
  await closeDatabase();
});

test("before-write crash leaves no task and no spend", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-crash-before");
  await domain.ledger.grantPurchasedCredits({ userId, amount: 2, note: "seed" });
  const counterFile = createCounterFile();

  const run = await runWorker("before-write", userId, "before-write-rk", counterFile);
  assertFreshSigkill(run, "before-write");
  assert.equal(readCount(counterFile), 0);

  const rows = await db
    .select()
    .from(nanoTasks)
    .where(eq(nanoTasks.subjectKey, `user:${userId}`));
  assert.equal(rows.length, 0);
  await assertExactCredits(userId, 2);
  assert.equal(readCount(counterFile), 0);
  rmSync(counterFile, { force: true });
});

test("after-spend-before-commit rolls the spend back", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-crash-spend");
  await domain.ledger.grantPurchasedCredits({ userId, amount: 2, note: "seed" });
  const counterFile = createCounterFile();

  const run = await runWorker("after-spend-before-commit", userId, "spend-crash-rk", counterFile);
  assertFreshSigkill(run, "after-spend-before-commit");
  assert.equal(readCount(counterFile), 0);

  const rows = await db
    .select()
    .from(nanoTasks)
    .where(eq(nanoTasks.subjectKey, `user:${userId}`));
  assert.equal(rows.length, 0);
  await assertExactCredits(userId, 2);
  rmSync(counterFile, { force: true });
});

test("after-commit-before-dispatch leaves a scannable queued task and dispatches exactly once", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-crash-dispatch");
  await domain.ledger.grantPurchasedCredits({ userId, amount: 2, note: "seed" });
  const counterFile = createCounterFile();

  const run = await runWorker("after-commit-before-dispatch", userId, "dispatch-rk", counterFile);
  assertFreshSigkill(run, "after-commit-before-dispatch");

  const [task] = await db
    .select()
    .from(nanoTasks)
    .where(
      and(
        eq(nanoTasks.subjectKey, `user:${userId}`),
        eq(nanoTasks.requestKey, "dispatch-rk"),
      ),
    );
  assert.ok(task);
  assert.equal(task.status, "queued");

  const provider = new CountingNanoProvider(counterFile);
  const swept = await sweepDispatchable(coordinator, provider, dispatchConfig);
  assert.equal(swept, 1);

  const [final] = await db
    .select()
    .from(nanoTasks)
    .where(eq(nanoTasks.id, task.id));
  assert.equal(final.status, "succeeded");
  assert.equal(readCount(counterFile), 1);
  assert.ok(final.resultRef);

  await assertExactCredits(userId, 1);
  rmSync(counterFile, { force: true });
});

test("after-remote-before-association surfaces unknown without re-send", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-crash-remote");
  await domain.ledger.grantPurchasedCredits({ userId, amount: 2, note: "seed" });
  const counterFile = createCounterFile();

  const run = await runWorker("after-remote-before-association", userId, "remote-rk", counterFile);
  assertFreshSigkill(run, "after-remote-before-association");
  assert.equal(readCount(counterFile), 1);

  const expiredNow = new Date(Date.now() + 120_000);
  const swept = await sweepStaleInFlight(coordinator, expiredNow);
  assert.equal(swept, 1);
  assert.equal(readCount(counterFile), 1);
  await assertExactCredits(userId, 1);

  const [task] = await db
    .select()
    .from(nanoTasks)
    .where(
      and(
        eq(nanoTasks.subjectKey, `user:${userId}`),
        eq(nanoTasks.requestKey, "remote-rk"),
      ),
    );
  assert.equal(task.status, "unknown");
  const [activeJob] = await db
    .select()
    .from(nanoActiveJobs)
    .where(eq(nanoActiveJobs.taskId, task.id));
  assert.ok(activeJob);
  rmSync(counterFile, { force: true });
});

test("after-stage-before-terminal recovers succeeded without re-send", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-crash-staged");
  await domain.ledger.grantPurchasedCredits({ userId, amount: 2, note: "seed" });
  const counterFile = createCounterFile();

  const run = await runWorker("after-stage-before-terminal", userId, "staged-rk", counterFile);
  assertFreshSigkill(run, "after-stage-before-terminal");
  assert.equal(readCount(counterFile), 1);

  const expiredNow = new Date(Date.now() + 120_000);
  const swept = await sweepStaged(coordinator, expiredNow);
  assert.equal(swept, 1);
  assert.equal(readCount(counterFile), 1);
  await assertExactCredits(userId, 1);

  const [task] = await db
    .select()
    .from(nanoTasks)
    .where(
      and(
        eq(nanoTasks.subjectKey, `user:${userId}`),
        eq(nanoTasks.requestKey, "staged-rk"),
      ),
    );
  assert.equal(task.status, "succeeded");
  assert.ok(task.resultRef);
  const [activeJob] = await db
    .select()
    .from(nanoActiveJobs)
    .where(eq(nanoActiveJobs.taskId, task.id));
  assert.equal(activeJob, undefined);
  rmSync(counterFile, { force: true });
});

test("before-terminal-commit rolls the refund back and keeps the task active", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-crash-terminal");
  await domain.ledger.grantPurchasedCredits({ userId, amount: 2, note: "seed" });
  const counterFile = createCounterFile();

  const run = await runWorker("before-terminal-commit", userId, "terminal-rk", counterFile);
  assertFreshSigkill(run, "before-terminal-commit");
  assert.equal(readCount(counterFile), 0);

  const [task] = await db
    .select()
    .from(nanoTasks)
    .where(
      and(
        eq(nanoTasks.subjectKey, `user:${userId}`),
        eq(nanoTasks.requestKey, "terminal-rk"),
      ),
    );
  assert.equal(task.status, "queued");

  await assertExactCredits(userId, 1);
  const [activeJob] = await db
    .select()
    .from(nanoActiveJobs)
    .where(eq(nanoActiveJobs.taskId, task.id));
  assert.ok(activeJob);
  assert.equal(workerLaunches.size, 6);
  rmSync(counterFile, { force: true });
});
