/**
 * Nano PG coordinator (owned transaction + ledger) against real PostgreSQL.
 *
 * Controller-run with the same isolation guard as credits.test.ts. Verifies the
 * admit/spend/refund idempotency, cancel/fail single refund, subject ownership,
 * bounded list, case-selection idempotency + 30-day aggregation, active-job
 * restrict FK, product-bound instance isolation, and the lease/token CAS fence.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeDatabase, db } from "@/lib/db";
import {
  user as userTable,
  nanoActiveJobs,
  nanoTasks,
} from "@/lib/db/schema";
import {
  createNanoCoordinator,
  type NanoCoordinator,
} from "@sunpcm/niu-persistence-pg/nano";
import {
  nanoSubjectKey,
  NanoInvalidStateError,
  type NanoSubject,
} from "@sunpcm/niu-feature-nano";
import { migrate, resetSyntheticData } from "./helpers";
import { createDomainCommerce } from "./commerce-assembly";

const PRODUCT = "nexty_overnight_nano";
const OTHER_PRODUCT = "other_product";

const domain = createDomainCommerce({ productId: PRODUCT });
const otherDomain = createDomainCommerce({ productId: OTHER_PRODUCT });
const { grantPurchasedCredits } = domain.ledger;
const coordinator: NanoCoordinator = createNanoCoordinator({
  db,
  store: domain.app.store,
  commerce: domain.app.commerce,
  productId: PRODUCT,
});
const otherCoordinator: NanoCoordinator = createNanoCoordinator({
  db,
  store: otherDomain.app.store,
  commerce: otherDomain.app.commerce,
  productId: OTHER_PRODUCT,
});

function uniqueEmail(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}@example.invalid`;
}

async function createUser(prefix: string) {
  const [row] = await db
    .insert(userTable)
    .values({ email: uniqueEmail(prefix) })
    .returning({ id: userTable.id });
  return row.id;
}

async function assertExactCredits(userId: string, expectedPurchased: number) {
  const credits = await domain.credits.getUserCredits(userId);
  assert.equal(credits.subscriptionCredits, 0);
  assert.equal(credits.purchasedCredits, expectedPurchased);
  assert.equal(credits.totalCredits, expectedPurchased);
}

function assertNanoActiveJobRestrict(error: unknown): boolean {
  assert.equal(error instanceof Error, true);
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as {
      code?: unknown;
      cause?: unknown;
      message?: unknown;
      constraint_name?: unknown;
    };
    if (candidate.code === "23503") {
      assert.equal(candidate.constraint_name, "nano_active_jobs_user_id_user_id_fk");
      assert.match(String(candidate.message), /violates foreign key constraint/i);
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

function admitInput(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    productId: PRODUCT,
    subject: { userId, organizationId: null } as NanoSubject,
    actorUserId: userId,
    feature: "nano-image",
    requestKey: "rk-1",
    contentSummary: "sum-1",
    cost: 1,
    inputRef: { prompt: "a cat", imageData: "aGVsbG8=", mimeType: "image/png" },
    ...overrides,
  };
}

before(async () => {
  await migrate();
});

after(async () => {
  await closeDatabase();
});

test("admit spends once, records an active job, and is idempotent", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-admit");
  await grantPurchasedCredits({ userId, amount: 10, note: "seed" });

  const first = await coordinator.admit(admitInput(userId));
  assert.equal(first.created, true);
  assert.equal(first.task.status, "queued");
  assert.ok(first.task.spendTxId);

  const [activeJob] = await db
    .select()
    .from(nanoActiveJobs)
    .where(eq(nanoActiveJobs.taskId, first.task.id));
  assert.ok(activeJob);

  await assertExactCredits(userId, 9);

  const second = await coordinator.admit(admitInput(userId));
  assert.equal(second.created, false);
  assert.equal(second.task.id, first.task.id);

  await assertExactCredits(userId, 9);

  await assert.rejects(
    coordinator.admit(admitInput(userId, { contentSummary: "sum-2" })),
    /requestKey was reused/,
  );
});

test("queued cancel refunds once; dispatched cancel is refused", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-cancel");
  await grantPurchasedCredits({ userId, amount: 5, note: "seed" });

  const admitted = await coordinator.admit(admitInput(userId, { requestKey: "cancel-1" }));
  const canceled = await coordinator.cancel(admitted.task.id);
  assert.equal(canceled.status, "canceled");

  await assertExactCredits(userId, 5);

  const again = await coordinator.cancel(admitted.task.id);
  assert.equal(again.status, "canceled");

  await assertExactCredits(userId, 5);

  const dispatched = await coordinator.admit(
    admitInput(userId, { requestKey: "cancel-2", contentSummary: "sum-2" }),
  );
  const claim = { leaseOwner: "worker", leaseToken: "tok-cancel" };
  const leased = await coordinator.markLeased(
    dispatched.task.id,
    claim,
    new Date(Date.now() + 60000),
  );
  assert.ok(leased);
  assert.equal(leased.status, "leased");
  const [activeJobBeforeRefusal] = await db
    .select()
    .from(nanoActiveJobs)
    .where(eq(nanoActiveJobs.taskId, dispatched.task.id));
  assert.ok(activeJobBeforeRefusal);

  async function assertCancelRefused(status: "leased" | "dispatching") {
    await assert.rejects(
      coordinator.cancel(dispatched.task.id),
      (error: unknown) => {
        assert.ok(error instanceof NanoInvalidStateError);
        assert.equal(error.code, "INVALID_STATE");
        assert.equal(error.message, `Cannot cancel nano task in state ${status}`);
        return true;
      },
    );

    await assertExactCredits(userId, 4);
    const [afterRefusal] = await db
      .select()
      .from(nanoTasks)
      .where(eq(nanoTasks.id, dispatched.task.id));
    assert.ok(afterRefusal);
    assert.equal(afterRefusal.status, status);
    assert.equal(afterRefusal.cost, 1);
    assert.equal(afterRefusal.spendTxId, dispatched.task.spendTxId);

    const [activeJobAfterRefusal] = await db
      .select()
      .from(nanoActiveJobs)
      .where(eq(nanoActiveJobs.taskId, dispatched.task.id));
    assert.deepEqual(activeJobAfterRefusal, activeJobBeforeRefusal);
  }

  await assertCancelRefused("leased");
  const dispatching = await coordinator.markDispatching(
    dispatched.task.id,
    "cancel-2",
    claim,
  );
  assert.ok(dispatching);
  assert.equal(dispatching.status, "dispatching");
  await assertCancelRefused("dispatching");
});

test("failure refunds once and late completion does not re-deliver", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-fail");
  await grantPurchasedCredits({ userId, amount: 3, note: "seed" });

  const admitted = await coordinator.admit(admitInput(userId, { requestKey: "fail-1" }));
  const claim = { leaseOwner: "worker", leaseToken: "tok-fail" };
  await coordinator.markLeased(admitted.task.id, claim, new Date(Date.now() + 60000));
  await coordinator.markDispatching(admitted.task.id, "fail-1", claim);

  const failed = await coordinator.fail(admitted.task.id, claim);
  assert.equal(failed.status, "failed");

  await assertExactCredits(userId, 3);

  await coordinator.fail(admitted.task.id, claim);
  await assertExactCredits(userId, 3);

  const late = await coordinator.complete(admitted.task.id, {
    resultRef: JSON.stringify({ images: [], text: null }),
    resultSummary: "late",
  }, claim);
  assert.equal(late.status, "failed");
  assert.equal(late.resultRef, null);
});

test("two scanners cannot both claim the same queued task", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-fence");
  await grantPurchasedCredits({ userId, amount: 2, note: "seed" });
  const admitted = await coordinator.admit(admitInput(userId, { requestKey: "fence-1" }));

  const first = await coordinator.markLeased(
    admitted.task.id,
    { leaseOwner: "a", leaseToken: "tok-a" },
    new Date(Date.now() + 60000),
  );
  assert.ok(first);

  const second = await coordinator.markLeased(
    admitted.task.id,
    { leaseOwner: "b", leaseToken: "tok-b" },
    new Date(Date.now() + 60000),
  );
  assert.equal(second, null);
});

test("an expired owner cannot terminalize a task reclaimed by another owner", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-expired");
  await grantPurchasedCredits({ userId, amount: 2, note: "seed" });
  const admitted = await coordinator.admit(admitInput(userId, { requestKey: "expired-1" }));

  const oldClaim = { leaseOwner: "old", leaseToken: "old-tok" };
  const oldLease = await coordinator.markLeased(
    admitted.task.id,
    oldClaim,
    new Date(Date.now() - 1000),
  );
  assert.ok(oldLease);
  assert.ok(oldLease.leaseUntil && oldLease.leaseUntil.getTime() < Date.now());
  assert.equal(oldLease.leaseOwner, oldClaim.leaseOwner);
  assert.equal(oldLease.leaseToken, oldClaim.leaseToken);

  const freshClaim = { leaseOwner: "new", leaseToken: "new-tok" };
  const reclaimed = await coordinator.markLeased(
    admitted.task.id,
    freshClaim,
    new Date(Date.now() + 60000),
  );
  assert.ok(reclaimed);
  assert.equal(reclaimed.leaseOwner, freshClaim.leaseOwner);
  assert.equal(reclaimed.leaseToken, freshClaim.leaseToken);

  await assert.rejects(coordinator.fail(admitted.task.id, oldClaim), /Cannot fail/);
  const still = await coordinator.get(admitted.task.id);
  assert.equal(still?.status, "leased");
  assert.equal(still?.leaseOwner, freshClaim.leaseOwner);
  assert.equal(still?.leaseToken, freshClaim.leaseToken);
});

test("listBySubject is bounded and scoped to the balance owner", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-list");
  await grantPurchasedCredits({ userId, amount: 10, note: "seed" });

  for (let i = 0; i < 5; i += 1) {
    await coordinator.admit(
      admitInput(userId, { requestKey: `list-${i}`, contentSummary: `sum-${i}` }),
    );
  }

  const page1 = await coordinator.listBySubject(nanoSubjectKey({ userId, organizationId: null }), {
    cursor: null,
    limit: 2,
  });
  assert.equal(page1.tasks.length, 2);
  assert.ok(page1.nextCursor);

  const page2 = await coordinator.listBySubject(nanoSubjectKey({ userId, organizationId: null }), {
    cursor: page1.nextCursor,
    limit: 2,
  });
  assert.equal(page2.tasks.length, 2);
  assert.ok(page2.nextCursor);

  const page3 = await coordinator.listBySubject(nanoSubjectKey({ userId, organizationId: null }), {
    cursor: page2.nextCursor,
    limit: 2,
  });
  assert.equal(page3.tasks.length, 1);
  assert.equal(page3.nextCursor, null);
});

test("case selection is idempotent and 30-day stats are product-scoped", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-case");

  const first = await coordinator.recordCaseSelection({
    productId: PRODUCT,
    caseId: "case-a",
    requestKey: "case-rk-1",
    userId,
    selectedAt: new Date(),
  });
  assert.equal(first.recorded, true);

  const replay = await coordinator.recordCaseSelection({
    productId: PRODUCT,
    caseId: "case-a",
    requestKey: "case-rk-1",
    userId,
    selectedAt: new Date(),
  });
  assert.equal(replay.recorded, false);

  await coordinator.recordCaseSelection({
    productId: PRODUCT,
    caseId: "case-b",
    requestKey: "case-rk-2",
    userId,
    selectedAt: new Date(),
  });

  const stats = await coordinator.caseStatsSince(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  assert.equal(stats["case-a"], 1);
  assert.equal(stats["case-b"], 1);

  const other = await otherCoordinator.caseStatsSince(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  assert.deepEqual(other, {});
});

test("product-bound instances cannot read, list, or claim across products", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-product");
  await grantPurchasedCredits({ userId, amount: 5, note: "seed" });

  const task = await coordinator.admit(admitInput(userId, { requestKey: "product-rk" }));
  assert.equal(task.created, true);

  assert.equal(await otherCoordinator.get(task.task.id), null);
  const list = await otherCoordinator.listBySubject(nanoSubjectKey({ userId, organizationId: null }), {
    cursor: null,
    limit: 10,
  });
  assert.equal(list.tasks.length, 0);

  // A different product can create its own task under the same subject+requestKey.
  const otherTask = await otherCoordinator.admit({
    productId: OTHER_PRODUCT,
    subject: { userId, organizationId: null },
    actorUserId: userId,
    feature: "nano-image",
    requestKey: "product-rk",
    contentSummary: "sum-1",
    cost: 1,
    inputRef: { prompt: "a cat", imageData: "aGVsbG8=", mimeType: "image/png" },
  });
  assert.equal(otherTask.created, true);
  assert.notEqual(otherTask.task.id, task.task.id);
});

test("staged result is finalized, stale in-flight without result is marked unknown", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-staged");
  await grantPurchasedCredits({ userId, amount: 2, note: "seed" });

  const staged = await coordinator.admit(admitInput(userId, { requestKey: "staged-1", contentSummary: "sum-staged" }));
  const claim = { leaseOwner: "worker", leaseToken: "tok-staged" };
  await coordinator.markLeased(staged.task.id, claim, new Date(Date.now() - 1000));
  await coordinator.markDispatching(staged.task.id, "staged-1", claim);
  const ref = JSON.stringify({ images: [{ mimeType: "image/png", dataBase64: "AA==" }], text: null });
  await coordinator.stageResult(staged.task.id, ref, "1 image", claim);

  const recoverable = await coordinator.listStaged(new Date(), 10);
  assert.ok(recoverable.some((t) => t.id === staged.task.id));

  const finalized = await coordinator.complete(staged.task.id, { resultRef: ref, resultSummary: "1 image" }, null);
  assert.equal(finalized.status, "succeeded");

  const stale = await coordinator.admit(admitInput(userId, { requestKey: "stale-1", contentSummary: "sum-stale" }));
  const staleClaim = { leaseOwner: "worker", leaseToken: "tok-stale" };
  await coordinator.markLeased(stale.task.id, staleClaim, new Date(Date.now() - 1000));
  await coordinator.markDispatching(stale.task.id, "stale-1", staleClaim);

  const staleRows = await coordinator.listStaleInFlight(new Date(), 10);
  assert.ok(staleRows.some((t) => t.id === stale.task.id));

  const unknown = await coordinator.markUnknown(stale.task.id);
  assert.equal(unknown.status, "unknown");
});

test("active job restrict FK blocks account deletion until terminal", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-delete");
  await grantPurchasedCredits({ userId, amount: 2, note: "seed" });
  const admitted = await coordinator.admit(admitInput(userId, { requestKey: "delete-1" }));

  await assert.rejects(
    db.delete(userTable).where(eq(userTable.id, userId)),
    assertNanoActiveJobRestrict,
  );
  const [protectedUser] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.id, userId));
  assert.equal(protectedUser?.id, userId);

  await coordinator.cancel(admitted.task.id);
  const [taskRow] = await db
    .select()
    .from(nanoTasks)
    .where(eq(nanoTasks.id, admitted.task.id));
  assert.equal(taskRow.status, "canceled");

  await db.delete(userTable).where(eq(userTable.id, userId));
  const [deletedUser] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.id, userId));
  assert.equal(deletedUser, undefined);
});

test("coordinator rejects a productId that disagrees with the bound Commerce", () => {
  assert.throws(
    () =>
      createNanoCoordinator({
        db,
        store: domain.app.store,
        commerce: domain.app.commerce,
        productId: "mismatched-product",
      }),
    /must match the bound Commerce productId/,
  );
});

test("a late result stages and finalizes a task marked unknown, without double refund", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-late-result");
  await grantPurchasedCredits({ userId, amount: 2, note: "seed" });

  const admitted = await coordinator.admit(
    admitInput(userId, { requestKey: "late-result", contentSummary: "sum-late" }),
  );
  const claim = { leaseOwner: "worker", leaseToken: "late-tok" };
  await coordinator.markLeased(admitted.task.id, claim, new Date(Date.now() - 1000));
  await coordinator.markDispatching(admitted.task.id, "late-result", claim);

  // A second scanner converges the expired in-flight row to unknown (no claim).
  await coordinator.markUnknown(admitted.task.id);
  assert.equal((await coordinator.get(admitted.task.id))?.status, "unknown");

  const ref = JSON.stringify({ images: [{ mimeType: "image/png", dataBase64: "AA==" }], text: null });
  const staged = await coordinator.stageResult(admitted.task.id, ref, "1 image", claim);
  assert.ok(staged);
  assert.equal(staged.resultRef, ref);

  const finalized = await coordinator.complete(
    admitted.task.id,
    { resultRef: ref, resultSummary: "1 image" },
    claim,
  );
  assert.equal(finalized.status, "succeeded");
  assert.equal(finalized.resultRef, ref);

  await assertExactCredits(userId, 1);
});
