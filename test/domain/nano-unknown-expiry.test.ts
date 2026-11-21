/**
 * Nano unknown-expiry policy against real PostgreSQL.
 *
 * Controller-run with the same isolation guard as nano-pg-coordinator.test.ts.
 * Covers: an expired `unknown` task is failed + refunded exactly once and no
 * longer blocks account deletion; young, staged, and other-product tasks are
 * left alone; concurrent sweeps refund once; a late result after expiry is
 * dropped; and status/list reads never load the uploaded input.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeDatabase, db } from "@/lib/db";
import { nanoActiveJobs, nanoTasks, user as userTable } from "@/lib/db/schema";
import { createNanoCoordinator, type NanoCoordinator } from "@sunpcm/niu-persistence-pg/nano";
import { nanoSubjectKey, type NanoClaim, type NanoSubject } from "@sunpcm/niu-feature-nano";
import { sweepExpiredUnknown, type NanoUnknownRefundedEvent } from "@/lib/nano/dispatch";
import { migrate, resetSyntheticData } from "./helpers";
import { createDomainCommerce } from "./commerce-assembly";

const PRODUCT = "nexty_overnight_nano";
const OTHER_PRODUCT = "other_product";
const REFUND_AFTER_MS = 600_000;

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

async function createUser(prefix: string) {
  const [row] = await db
    .insert(userTable)
    .values({ email: `${prefix}-${crypto.randomUUID()}@example.invalid` })
    .returning({ id: userTable.id });
  return row.id;
}

async function purchased(userId: string): Promise<number> {
  return (await domain.credits.getUserCredits(userId)).purchasedCredits;
}

function admitInput(userId: string, requestKey: string, product = PRODUCT) {
  return {
    productId: product,
    subject: { userId, organizationId: null } as NanoSubject,
    actorUserId: userId,
    feature: "nano-image",
    requestKey,
    contentSummary: `sum-${requestKey}`,
    cost: 1,
    inputRef: { prompt: "a cat", imageData: "aGVsbG8=", mimeType: "image/png" },
  };
}

async function admitUnknown(
  target: NanoCoordinator,
  userId: string,
  requestKey: string,
  product = PRODUCT,
): Promise<{ id: string; claim: NanoClaim }> {
  const admitted = await target.admit(admitInput(userId, requestKey, product));
  const claim = { leaseOwner: "lost-worker", leaseToken: `tok-${requestKey}` };
  await target.markLeased(admitted.task.id, claim, new Date(Date.now() - 1_000));
  await target.markDispatching(admitted.task.id, requestKey, claim);
  const unknown = await target.markUnknown(admitted.task.id);
  assert.equal(unknown.status, "unknown");
  return { id: admitted.task.id, claim };
}

/** A sweep clock far enough ahead that a just-created unknown counts as expired. */
function afterExpiry(): Date {
  return new Date(Date.now() + REFUND_AFTER_MS + 60_000);
}

before(async () => {
  await migrate();
});

after(async () => {
  await closeDatabase();
});

test("expired unknown is failed, refunded once, and unblocks account deletion", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-expire");
  await grantPurchasedCredits({ userId, amount: 2, note: "seed" });
  const { id } = await admitUnknown(coordinator, userId, "expire-1");
  assert.equal(await purchased(userId), 1);

  const events: NanoUnknownRefundedEvent[] = [];
  const refunded = await sweepExpiredUnknown(coordinator, REFUND_AFTER_MS, afterExpiry(), 100, (e) =>
    events.push(e),
  );
  assert.equal(refunded, 1);
  assert.deepEqual(events, [{ taskId: id, cost: 1 }]);

  const [row] = await db.select().from(nanoTasks).where(eq(nanoTasks.id, id));
  assert.equal(row.status, "failed");
  assert.equal(row.leaseOwner, null);
  assert.equal(row.leaseToken, null);
  assert.equal(await purchased(userId), 2);
  const active = await db.select().from(nanoActiveJobs).where(eq(nanoActiveJobs.taskId, id));
  assert.equal(active.length, 0);

  // A second sweep finds nothing and refunds nothing.
  assert.equal(await sweepExpiredUnknown(coordinator, REFUND_AFTER_MS, afterExpiry()), 0);
  assert.equal(await purchased(userId), 2);

  await db.delete(userTable).where(eq(userTable.id, userId));
  const left = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.id, userId));
  assert.equal(left.length, 0);
});

test("young, staged, and other-product unknown tasks are not refunded", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-keep");
  await grantPurchasedCredits({ userId, amount: 3, note: "seed" });

  const young = await admitUnknown(coordinator, userId, "young-1");
  const staged = await admitUnknown(coordinator, userId, "staged-1");
  const ref = JSON.stringify({ images: [{ mimeType: "image/png", dataBase64: "AA==" }], text: null });
  assert.ok(await coordinator.stageResult(staged.id, ref, "1 image", staged.claim));
  const foreign = await admitUnknown(otherCoordinator, userId, "foreign-1", OTHER_PRODUCT);
  assert.equal(await purchased(userId), 0);

  // Real clock: nothing is old enough yet.
  assert.equal(await sweepExpiredUnknown(coordinator, REFUND_AFTER_MS, new Date()), 0);
  const [youngRow] = await db.select().from(nanoTasks).where(eq(nanoTasks.id, young.id));
  assert.equal(youngRow.status, "unknown");

  // Past the threshold: only the un-staged task of this product is refunded.
  assert.equal(await sweepExpiredUnknown(coordinator, REFUND_AFTER_MS, afterExpiry()), 1);
  const rows = await db.select().from(nanoTasks);
  const status = (id: string) => rows.find((r) => r.id === id)?.status;
  assert.equal(status(young.id), "failed");
  assert.equal(status(staged.id), "unknown");
  assert.equal(status(foreign.id), "unknown");
  assert.equal(await purchased(userId), 1);

  // The staged task is still finalized by the normal recovery path.
  const done = await coordinator.complete(staged.id, { resultRef: ref, resultSummary: "1 image" }, null);
  assert.equal(done.status, "succeeded");
});

test("concurrent expiry refunds exactly once", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-race");
  await grantPurchasedCredits({ userId, amount: 2, note: "seed" });
  const { id } = await admitUnknown(coordinator, userId, "race-1");
  const cutoff = new Date(Date.now() + 60_000);

  const results = await Promise.all([
    coordinator.expireUnknown(id, cutoff),
    coordinator.expireUnknown(id, cutoff),
    coordinator.expireUnknown(id, cutoff),
  ]);
  assert.equal(results.filter((r) => r.refunded).length, 1);
  assert.ok(results.every((r) => r.task.status === "failed"));
  assert.equal(await purchased(userId), 2);
});

test("a late result after expiry is dropped and does not undo the refund", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-late");
  await grantPurchasedCredits({ userId, amount: 2, note: "seed" });
  const { id, claim } = await admitUnknown(coordinator, userId, "late-1");
  await coordinator.expireUnknown(id, new Date(Date.now() + 60_000));

  assert.equal(await coordinator.stageResult(id, "{}", "1 image", claim), null);
  const late = await coordinator.complete(id, { resultRef: "{}", resultSummary: "1 image" }, claim);
  assert.equal(late.status, "failed");
  const lateFail = await coordinator.fail(id, claim);
  assert.equal(lateFail.status, "failed");
  assert.equal(await purchased(userId), 2);
});

test("status and list reads do not load the uploaded input", async () => {
  await resetSyntheticData();
  const userId = await createUser("nano-projection");
  await grantPurchasedCredits({ userId, amount: 2, note: "seed" });
  const admitted = await coordinator.admit(admitInput(userId, "projection-1"));

  // Dispatch still receives the input.
  const [dispatchable] = await coordinator.listDispatchable(new Date(), 10);
  assert.equal(dispatchable.inputRef?.imageData, "aGVsbG8=");

  const claim = { leaseOwner: "worker", leaseToken: "tok-projection" };
  const leased = await coordinator.markLeased(admitted.task.id, claim, new Date(Date.now() + 60_000));
  assert.equal(leased?.status, "leased");
  assert.equal(leased?.inputRef, null);
  await coordinator.markDispatching(admitted.task.id, "projection-1", claim);
  const ref = JSON.stringify({ images: [{ mimeType: "image/png", dataBase64: "AA==" }], text: null });
  await coordinator.stageResult(admitted.task.id, ref, "1 image", claim);
  await coordinator.complete(admitted.task.id, { resultRef: ref, resultSummary: "1 image" }, claim);

  const polled = await coordinator.get(admitted.task.id);
  assert.equal(polled?.status, "succeeded");
  assert.equal(polled?.inputRef, null);
  assert.equal(polled?.resultRef, ref);

  const page = await coordinator.listBySubject(nanoSubjectKey({ userId, organizationId: null }), {
    cursor: null,
    limit: 10,
  });
  assert.equal(page.tasks.length, 1);
  assert.equal(page.tasks[0].id, admitted.task.id);
  assert.equal(page.tasks[0].inputRef, null);
  assert.equal(page.tasks[0].resultRef, null);

  // The row itself still holds the input for audit/re-dispatch semantics.
  const [row] = await db.select().from(nanoTasks).where(eq(nanoTasks.id, admitted.task.id));
  assert.equal(row.inputRef?.imageData, "aGVsbG8=");
  assert.equal(await otherCoordinator.get(admitted.task.id), null);
});
