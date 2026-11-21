import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVE_NANO_STATUSES,
  TERMINAL_NANO_STATUSES,
  admitTask,
  cancelTask,
  completeTask,
  dispatchDecision,
  expireUnknownTask,
  failTask,
  markUnknown,
  nanoSubjectKey,
  NanoIdempotencyConflictError,
  NanoInvalidInputError,
  NanoInvalidStateError,
} from "../../packages/feature-nano/dist/index.js";

const TERMINAL_FROM = new Set(["queued", "leased", "dispatching", "running", "unknown"]);
const IN_FLIGHT = new Set(["dispatching", "running"]);
const STAGEABLE = new Set(["dispatching", "running", "unknown"]);

function claim(owner = "worker", token = "tok-1") {
  return { leaseOwner: owner, leaseToken: token };
}

function subjectKeyOf(subject) {
  return nanoSubjectKey(subject);
}

function makeFakeUnit() {
  const tasks = new Map();
  const activeJobs = new Set();
  let seq = 0;
  const spends = [];
  const refunds = [];

  function mkTask(input, id) {
    const now = new Date();
    return {
      id,
      productId: input.productId,
      subjectKey: subjectKeyOf(input.subject),
      subject: input.subject,
      feature: input.feature,
      requestKey: input.requestKey,
      contentSummary: input.contentSummary,
      inputRef: input.inputRef,
      status: input.status,
      cost: input.cost,
      spendTxId: null,
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

  const repo = {
    async insertAdmitted(input) {
      const subjectKey = subjectKeyOf(input.subject);
      const existing = [...tasks.values()].find(
        (t) =>
          t.productId === input.productId &&
          t.subjectKey === subjectKey &&
          t.feature === input.feature &&
          t.requestKey === input.requestKey,
      );
      if (existing) return { task: existing, inserted: false };
      const id = `task-${++seq}`;
      const task = mkTask(input, id);
      tasks.set(id, task);
      return { task, inserted: true };
    },
    async attachSpendTxId(id, spendTxId) {
      tasks.get(id).spendTxId = spendTxId;
    },
    async insertActiveJob(taskId) {
      activeJobs.add(taskId);
    },
    async loadById(id) {
      return tasks.get(id) ?? null;
    },
    async transitionToSucceeded(id, resultRef, resultSummary, claimArg) {
      const t = tasks.get(id);
      if (!t || !TERMINAL_FROM.has(t.status)) return null;
      if (claimArg) {
        if (t.leaseOwner !== claimArg.leaseOwner || t.leaseToken !== claimArg.leaseToken) return null;
      } else if (!t.resultRef) {
        return null;
      }
      t.status = "succeeded";
      if (claimArg) {
        t.resultRef = resultRef;
        t.resultSummary = resultSummary;
      }
      activeJobs.delete(id);
      return t;
    },
    async transitionToFailed(id, claimArg) {
      const t = tasks.get(id);
      if (!t || !claimArg || !TERMINAL_FROM.has(t.status)) return null;
      if (t.leaseOwner !== claimArg.leaseOwner || t.leaseToken !== claimArg.leaseToken) return null;
      t.status = "failed";
      activeJobs.delete(id);
      return t;
    },
    async transitionToCanceled(id) {
      const t = tasks.get(id);
      if (!t || t.status !== "queued") return null;
      t.status = "canceled";
      activeJobs.delete(id);
      return t;
    },
    async transitionToUnknown(id, claimArg) {
      const t = tasks.get(id);
      if (!t || !IN_FLIGHT.has(t.status)) return null;
      if (claimArg) {
        if (t.leaseOwner !== claimArg.leaseOwner || t.leaseToken !== claimArg.leaseToken) return null;
      } else if (t.resultRef) {
        return null;
      }
      t.status = "unknown";
      t.updatedAt = new Date();
      return t;
    },
    async expireUnknown(id, enteredBefore) {
      const t = tasks.get(id);
      if (!t || t.status !== "unknown" || t.resultRef) return null;
      if (t.updatedAt.getTime() > enteredBefore.getTime()) return null;
      t.status = "failed";
      t.leaseOwner = null;
      t.leaseToken = null;
      activeJobs.delete(id);
      return t;
    },
    async listExpiredUnknown(enteredBefore) {
      return [...tasks.values()]
        .filter(
          (t) =>
            t.status === "unknown" && !t.resultRef && t.updatedAt.getTime() <= enteredBefore.getTime(),
        )
        .map((t) => t.id);
    },
    async stageResult(id, resultRef, resultSummary, claimArg) {
      const t = tasks.get(id);
      if (!t || !STAGEABLE.has(t.status)) return null;
      if (t.leaseOwner !== claimArg.leaseOwner || t.leaseToken !== claimArg.leaseToken) return null;
      t.resultRef = resultRef;
      t.resultSummary = resultSummary;
      return t;
    },
    async listDispatchable(now) {
      return [...tasks.values()].filter(
        (t) =>
          t.status === "queued" ||
          (t.status === "leased" && (!t.leaseUntil || t.leaseUntil.getTime() <= now.getTime())),
      );
    },
    async listStaleInFlight(now) {
      return [...tasks.values()].filter(
        (t) =>
          IN_FLIGHT.has(t.status) && !t.resultRef && t.leaseUntil && t.leaseUntil.getTime() <= now.getTime(),
      );
    },
    async listStaged(now) {
      return [...tasks.values()].filter(
        (t) => STAGEABLE.has(t.status) && t.resultRef && t.leaseUntil && t.leaseUntil.getTime() <= now.getTime(),
      );
    },
    async listBySubject() {
      return { tasks: [], nextCursor: null };
    },
    async markLeased(id, claimArg, leaseUntil) {
      const t = tasks.get(id);
      if (!t) return null;
      const now = new Date();
      const expired = t.status === "leased" && (!t.leaseUntil || t.leaseUntil.getTime() <= now.getTime());
      if (t.status !== "queued" && !expired) return null;
      t.status = "leased";
      t.leaseOwner = claimArg.leaseOwner;
      t.leaseToken = claimArg.leaseToken;
      t.leaseUntil = leaseUntil;
      return t;
    },
    async markDispatching(id, providerRequestKey, claimArg) {
      const t = tasks.get(id);
      if (!t || t.status !== "leased") return null;
      if (t.leaseOwner !== claimArg.leaseOwner || t.leaseToken !== claimArg.leaseToken) return null;
      t.status = "dispatching";
      t.providerRequestKey = providerRequestKey;
      return t;
    },
    async markRunning(id, providerTaskId, claimArg) {
      const t = tasks.get(id);
      if (!t || t.status !== "dispatching") return null;
      if (t.leaseOwner !== claimArg.leaseOwner || t.leaseToken !== claimArg.leaseToken) return null;
      t.status = "running";
      t.providerTaskId = providerTaskId;
      return t;
    },
    async recordCaseSelection() {
      return { recorded: true };
    },
    async caseStatsSince() {
      return {};
    },
  };

  const commerce = {
    async spendCredits(params) {
      spends.push(params);
      return { buckets: {}, txId: `spend-${spends.length}`, spentFromSubscription: params.amount, spentFromPurchased: 0 };
    },
    async refundSpentCredits(params) {
      refunds.push(params);
      return { subscription: 0, purchased: 0 };
    },
  };

  return { unit: { tasks: repo, commerce }, tasks, activeJobs, spends, refunds };
}

function admitInput(overrides = {}) {
  return {
    productId: "nexty",
    subject: { userId: "u1", organizationId: null },
    actorUserId: "u1",
    feature: "nano-image",
    requestKey: "rk-1",
    contentSummary: "sum-1",
    cost: 1,
    inputRef: { prompt: "hi", imageData: "aGVsbG8=", mimeType: "image/png" },
    ...overrides,
  };
}

test("subject key is balance-owner scoped and rejects invalid subjects", () => {
  assert.equal(nanoSubjectKey({ userId: "u1", organizationId: null }), "user:u1");
  assert.equal(nanoSubjectKey({ userId: null, organizationId: "o1" }), "org:o1");
  assert.throws(() => nanoSubjectKey({ userId: null, organizationId: null }), NanoInvalidInputError);
  assert.throws(() => nanoSubjectKey({ userId: "u1", organizationId: "o1" }), NanoInvalidInputError);
});

test("dispatch decision covers queue, stale lease, unknown and terminal", () => {
  const now = new Date("2026-11-07T00:00:00Z");
  const past = new Date("2026-11-06T00:00:00Z");
  const future = new Date("2026-11-08T00:00:00Z");
  const base = { productId: "p", subjectKey: "user:u1", subject: { userId: "u1", organizationId: null }, feature: "f", requestKey: "r", contentSummary: "s", cost: 1, spendTxId: null, providerRequestKey: null, providerTaskId: null, resultRef: null, resultSummary: null, leaseOwner: null, leaseToken: null, leaseUntil: null, createdAt: now, updatedAt: now };

  assert.equal(dispatchDecision({ ...base, status: "queued" }, now), "dispatch");
  assert.equal(dispatchDecision({ ...base, status: "leased", leaseUntil: null }, now), "dispatch");
  assert.equal(dispatchDecision({ ...base, status: "leased", leaseUntil: past }, now), "dispatch");
  assert.equal(dispatchDecision({ ...base, status: "leased", leaseUntil: future }, now), "skip");
  assert.equal(dispatchDecision({ ...base, status: "dispatching", leaseUntil: past }, now), "unknown");
  assert.equal(dispatchDecision({ ...base, status: "running", leaseUntil: past }, now), "unknown");
  assert.equal(dispatchDecision({ ...base, status: "running", leaseUntil: future }, now), "skip");
  for (const status of TERMINAL_NANO_STATUSES) {
    assert.equal(dispatchDecision({ ...base, status }, now), "skip");
  }
  assert.equal(dispatchDecision({ ...base, status: "unknown" }, now), "skip");
});

test("admit is idempotent for same key/content and conflicts without a second spend", async () => {
  const f = makeFakeUnit();
  const first = await admitTask(f.unit, admitInput());
  assert.equal(first.created, true);
  assert.equal(f.spends.length, 1);
  assert.equal(f.activeJobs.size, 1);

  const second = await admitTask(f.unit, admitInput());
  assert.equal(second.created, false);
  assert.equal(second.task.id, first.task.id);
  assert.equal(f.spends.length, 1);
  assert.equal(f.activeJobs.size, 1);

  await assert.rejects(
    admitTask(f.unit, admitInput({ contentSummary: "sum-2" })),
    NanoIdempotencyConflictError,
  );
  assert.equal(f.spends.length, 1);
});

test("queued cancel refunds exactly once and rejects dispatched cancel", async () => {
  const f = makeFakeUnit();
  const admitted = await admitTask(f.unit, admitInput());
  const canceled = await cancelTask(f.unit, admitted.task.id);
  assert.equal(canceled.status, "canceled");
  assert.equal(f.refunds.length, 1);

  const again = await cancelTask(f.unit, admitted.task.id);
  assert.equal(again.status, "canceled");
  assert.equal(f.refunds.length, 1);

  const f2 = makeFakeUnit();
  const admitted2 = await admitTask(f2.unit, admitInput({ requestKey: "rk-2" }));
  await f2.unit.tasks.markLeased(admitted2.task.id, claim(), new Date(Date.now() + 60000));
  await assert.rejects(cancelTask(f2.unit, admitted2.task.id), NanoInvalidStateError);
  assert.equal(f2.refunds.length, 0);
});

test("cancel loses the race to a valid claim and does not refund", async () => {
  const f = makeFakeUnit();
  const admitted = await admitTask(f.unit, admitInput());
  const c = claim();
  const leased = await f.unit.tasks.markLeased(admitted.task.id, c, new Date(Date.now() + 60000));
  assert.ok(leased);
  await assert.rejects(cancelTask(f.unit, admitted.task.id), NanoInvalidStateError);
  assert.equal(f.refunds.length, 0);
});

test("failure refunds once and late success does not re-deliver", async () => {
  const f = makeFakeUnit();
  const admitted = await admitTask(f.unit, admitInput());
  const c = claim();
  await f.unit.tasks.markLeased(admitted.task.id, c, new Date(Date.now() + 60000));
  await f.unit.tasks.markDispatching(admitted.task.id, "rk-1", c);

  const failed = await failTask(f.unit, admitted.task.id, c);
  assert.equal(failed.status, "failed");
  assert.equal(f.refunds.length, 1);

  const failedAgain = await failTask(f.unit, admitted.task.id, c);
  assert.equal(failedAgain.status, "failed");
  assert.equal(f.refunds.length, 1);

  const late = await completeTask(f.unit, admitted.task.id, {
    resultRef: JSON.stringify({ images: [], text: null }),
    resultSummary: "late",
  }, c);
  assert.equal(late.status, "failed");
  assert.equal(late.resultRef, null);
});

test("an expired owner cannot fail or complete a task it no longer owns", async () => {
  const f = makeFakeUnit();
  const admitted = await admitTask(
    f.unit,
    admitInput({ requestKey: "rk-expired" }),
  );
  const old = claim("old", "old-tok");
  const oldLease = await f.unit.tasks.markLeased(
    admitted.task.id,
    old,
    new Date(Date.now() - 1000),
  );
  assert.ok(oldLease);
  assert.equal(oldLease.leaseOwner, old.leaseOwner);
  const fresh = claim("new", "new-tok");
  const freshLease = await f.unit.tasks.markLeased(
    admitted.task.id,
    fresh,
    new Date(Date.now() + 60000),
  );
  assert.ok(freshLease);
  assert.equal(freshLease.leaseOwner, fresh.leaseOwner);
  assert.equal(freshLease.leaseToken, fresh.leaseToken);

  await assert.rejects(
    failTask(f.unit, admitted.task.id, old),
    NanoInvalidStateError,
  );
  assert.equal(f.refunds.length, 0);
  await assert.rejects(
    completeTask(
      f.unit,
      admitted.task.id,
      {
        resultRef: JSON.stringify({ images: [], text: null }),
        resultSummary: "stale result",
      },
      old,
    ),
    NanoInvalidStateError,
  );
  assert.equal(f.refunds.length, 0);
  assert.equal(f.tasks.get(admitted.task.id).status, "leased");
  assert.equal(f.tasks.get(admitted.task.id).leaseOwner, fresh.leaseOwner);
  assert.equal(f.tasks.get(admitted.task.id).resultRef, null);
});

test("markUnknown only moves dispatching/running without a result, or with a valid claim", async () => {
  const f = makeFakeUnit();
  const admitted = await admitTask(f.unit, admitInput({ requestKey: "rk-unknown" }));
  const c = claim();
  await f.unit.tasks.markLeased(admitted.task.id, c, new Date(Date.now() + 60000));
  await f.unit.tasks.markDispatching(admitted.task.id, "rk-unknown", c);
  const unknown = await markUnknown(f.unit, admitted.task.id, c);
  assert.equal(unknown.status, "unknown");
});

test("a late valid result stages and finalizes an unknown task held by the same claim", async () => {
  const f = makeFakeUnit();
  const admitted = await admitTask(f.unit, admitInput({ requestKey: "rk-late" }));
  const c = claim("late", "late-tok");
  await f.unit.tasks.markLeased(admitted.task.id, c, new Date(Date.now() + 60000));
  await f.unit.tasks.markDispatching(admitted.task.id, "rk-late", c);
  // Another scanner marks the expired in-flight task unknown without a claim.
  await f.unit.tasks.transitionToUnknown(admitted.task.id, null);
  assert.equal(f.tasks.get(admitted.task.id).status, "unknown");

  const ref = JSON.stringify({ images: [{ mimeType: "image/png", dataBase64: "AA==" }], text: null });
  const staged = await f.unit.tasks.stageResult(admitted.task.id, ref, "1 image", c);
  assert.ok(staged);
  assert.equal(staged.resultRef, ref);

  const done = await completeTask(f.unit, admitted.task.id, { resultRef: ref, resultSummary: "1 image" }, c);
  assert.equal(done.status, "succeeded");
  assert.equal(done.resultRef, ref);
});

test("staged result can be finalized without a claim and is excluded from stale in-flight", async () => {
  const f = makeFakeUnit();
  const admitted = await admitTask(f.unit, admitInput({ requestKey: "rk-staged" }));
  const c = claim();
  await f.unit.tasks.markLeased(admitted.task.id, c, new Date(Date.now() + 60000));
  await f.unit.tasks.markDispatching(admitted.task.id, "rk-staged", c);
  const ref = JSON.stringify({ images: [{ mimeType: "image/png", dataBase64: "AA==" }], text: null });
  await f.unit.tasks.stageResult(admitted.task.id, ref, "1 image", c);

  const expired = new Date(Date.now() + 120_000);
  const staged = await f.unit.tasks.listStaged(expired);
  assert.ok(staged.some((t) => t.id === admitted.task.id));
  const stale = await f.unit.tasks.listStaleInFlight(expired);
  assert.equal(stale.some((t) => t.id === admitted.task.id), false);

  const finalized = await completeTask(f.unit, admitted.task.id, { resultRef: ref, resultSummary: "1 image" }, null);
  assert.equal(finalized.status, "succeeded");
  assert.equal(finalized.resultRef, ref);
});

test("success/fail race serializes: fail after succeed returns terminal without refund", async () => {
  const f = makeFakeUnit();
  const admitted = await admitTask(f.unit, admitInput({ requestKey: "rk-race" }));
  const c = claim();
  await f.unit.tasks.markLeased(admitted.task.id, c, new Date(Date.now() + 60000));
  await f.unit.tasks.markDispatching(admitted.task.id, "rk-race", c);
  const ref = JSON.stringify({ images: [], text: null });
  const succeeded = await completeTask(f.unit, admitted.task.id, { resultRef: ref, resultSummary: "ok" }, c);
  assert.equal(succeeded.status, "succeeded");

  const failed = await failTask(f.unit, admitted.task.id, c);
  assert.equal(failed.status, "succeeded");
  assert.equal(f.refunds.length, 0);
});

async function admitUnknown(f, requestKey) {
  const admitted = await admitTask(f.unit, admitInput({ requestKey }));
  const c = claim("worker", `tok-${requestKey}`);
  await f.unit.tasks.markLeased(admitted.task.id, c, new Date(Date.now() - 1));
  await f.unit.tasks.markDispatching(admitted.task.id, requestKey, c);
  await markUnknown(f.unit, admitted.task.id);
  return { id: admitted.task.id, claim: c };
}

test("an expired unknown task fails, refunds once, and releases its active job", async () => {
  const f = makeFakeUnit();
  const { id } = await admitUnknown(f, "rk-expire");
  const cutoff = new Date(Date.now() + 1_000);

  assert.deepEqual(await f.unit.tasks.listExpiredUnknown(cutoff), [id]);
  const first = await expireUnknownTask(f.unit, id, cutoff);
  assert.equal(first.refunded, true);
  assert.equal(first.task.status, "failed");
  assert.equal(first.task.leaseToken, null);
  assert.equal(f.activeJobs.has(id), false);
  assert.equal(f.refunds.length, 1);
  assert.equal(f.refunds[0].spendTxId, "spend-1");
  assert.match(f.refunds[0].note, /^nano-unknown-refund:/);

  const second = await expireUnknownTask(f.unit, id, cutoff);
  assert.equal(second.refunded, false);
  assert.equal(second.task.status, "failed");
  assert.equal(f.refunds.length, 1);
});

test("an unknown task younger than the cutoff is left untouched", async () => {
  const f = makeFakeUnit();
  const { id } = await admitUnknown(f, "rk-young");
  const cutoff = new Date(Date.now() - 60_000);

  assert.deepEqual(await f.unit.tasks.listExpiredUnknown(cutoff), []);
  const result = await expireUnknownTask(f.unit, id, cutoff);
  assert.equal(result.refunded, false);
  assert.equal(result.task.status, "unknown");
  assert.equal(f.activeJobs.has(id), true);
  assert.equal(f.refunds.length, 0);
});

test("unknown expiry never refunds a staged, in-flight, or terminal task", async () => {
  const f = makeFakeUnit();
  const cutoff = new Date(Date.now() + 1_000);

  const staged = await admitUnknown(f, "rk-staged");
  await f.unit.tasks.stageResult(staged.id, "ref", "1 image", staged.claim);
  assert.equal((await expireUnknownTask(f.unit, staged.id, cutoff)).refunded, false);
  assert.equal(f.tasks.get(staged.id).status, "unknown");

  const queued = await admitTask(f.unit, admitInput({ requestKey: "rk-queued" }));
  assert.equal((await expireUnknownTask(f.unit, queued.task.id, cutoff)).refunded, false);
  assert.equal(f.tasks.get(queued.task.id).status, "queued");

  const done = await admitUnknown(f, "rk-done");
  await expireUnknownTask(f.unit, done.id, cutoff);
  assert.equal((await expireUnknownTask(f.unit, done.id, cutoff)).refunded, false);

  assert.equal(f.refunds.length, 1);
  await assert.rejects(expireUnknownTask(f.unit, "missing", cutoff), /not found/i);
});

test("a late result cannot be staged after an unknown task expired", async () => {
  const f = makeFakeUnit();
  const { id, claim: c } = await admitUnknown(f, "rk-late");
  await expireUnknownTask(f.unit, id, new Date(Date.now() + 1_000));

  assert.equal(await f.unit.tasks.stageResult(id, "ref", "1 image", c), null);
  const late = await completeTask(f.unit, id, { resultRef: "ref", resultSummary: "1 image" }, c);
  assert.equal(late.status, "failed");
  assert.equal(late.resultRef, null);
  assert.equal(f.refunds.length, 1);
});
