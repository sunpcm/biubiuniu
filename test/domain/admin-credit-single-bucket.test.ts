/**
 * Admin single-bucket credit operations (C07/C12).
 *
 * These run against the real PostgreSQL commerce store through the production
 * composition, so they are controller-run (same isolation guard as
 * credits.test.ts). They verify that add/set/deduct target exactly one bucket,
 * preserve the other, clamp deduction at zero, treat an explicit set-to-zero as
 * a real write, and record a structured trusted-actor note.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { closeDatabase, db } from "@/lib/db";
import { user as userTable, creditTransactions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { migrate, resetSyntheticData } from "./helpers";
import { createDomainCommerce } from "./commerce-assembly";

const domain = createDomainCommerce();
const {
  addCredits,
  setCredits,
  deductCredits,
  grantPurchasedCredits,
  resetSubscriptionCredits,
} = domain.ledger;

const ACTOR = "00000000-0000-4000-8000-0000000000ad";

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

async function balanceOf(userId: string) {
  return domain.credits.getUserCredits(userId);
}

async function notesOf(userId: string) {
  const rows = await db
    .select({ note: creditTransactions.note })
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId));
  return rows.map((r) => r.note);
}

before(async () => {
  await migrate();
});

after(async () => {
  await closeDatabase();
});

test("addCredits adds only the selected bucket and preserves the other", async () => {
  await resetSyntheticData();
  const userId = await createUser("admin-add");
  await grantPurchasedCredits({ userId, amount: 100, note: "seed" });

  const buckets = await addCredits({
    userId,
    bucket: "subscription",
    amount: 30,
    actorUserId: ACTOR,
    reason: "campaign grant",
  });

  assert.equal(buckets.subscription, 30);
  assert.equal(buckets.purchased, 100);
  const balance = await balanceOf(userId);
  assert.equal(balance.subscriptionCredits, 30);
  assert.equal(balance.purchasedCredits, 100);

  const notes = await notesOf(userId);
  assert.ok(
    notes.some((n) => n?.includes("[admin:add:subscription]") && n.includes(`actor=${ACTOR}`)),
    "structured trusted-actor note must be recorded",
  );
});

test("setCredits sets exactly one bucket and an explicit 0 is a real write", async () => {
  await resetSyntheticData();
  const userId = await createUser("admin-set");
  await grantPurchasedCredits({ userId, amount: 100, note: "seed" });
  await resetSubscriptionCredits({ userId, amount: 50, note: "seed" });

  const buckets = await setCredits({
    userId,
    bucket: "subscription",
    amount: 0,
    actorUserId: ACTOR,
    reason: "clear subscription",
  });

  assert.equal(buckets.subscription, 0);
  assert.equal(buckets.purchased, 100);
  const balance = await balanceOf(userId);
  assert.equal(balance.subscriptionCredits, 0);
  assert.equal(balance.purchasedCredits, 100);
});

test("deductCredits clamps the target bucket at zero and never touches the other", async () => {
  await resetSyntheticData();
  const userId = await createUser("admin-deduct");
  await grantPurchasedCredits({ userId, amount: 100, note: "seed" });
  await resetSubscriptionCredits({ userId, amount: 50, note: "seed" });

  const buckets = await deductCredits({
    userId,
    bucket: "purchased",
    amount: 999,
    actorUserId: ACTOR,
    reason: "clamp test",
  });

  assert.equal(buckets.purchased, 0);
  assert.equal(buckets.subscription, 50);
  const balance = await balanceOf(userId);
  assert.equal(balance.purchasedCredits, 0);
  assert.equal(balance.subscriptionCredits, 50);
});

test("single-bucket operations reject invalid amount, reason and actor", async () => {
  await resetSyntheticData();
  const userId = await createUser("admin-invalid");
  await grantPurchasedCredits({ userId, amount: 10, note: "seed" });

  await assert.rejects(
    () =>
      addCredits({
        userId,
        bucket: "purchased",
        amount: -1,
        actorUserId: ACTOR,
        reason: "bad",
      }),
    /non-negative/,
  );
  await assert.rejects(
    () =>
      addCredits({
        userId,
        bucket: "purchased",
        amount: 1.5,
        actorUserId: ACTOR,
        reason: "bad",
      }),
    /safe integer/,
  );
  await assert.rejects(
    () =>
      addCredits({
        userId,
        bucket: "purchased",
        amount: 1,
        actorUserId: "",
        reason: "bad",
      }),
    /required/,
  );
  await assert.rejects(
    () =>
      addCredits({
        userId,
        bucket: "purchased",
        amount: 1,
        actorUserId: ACTOR,
        reason: "",
      }),
    /required/,
  );

  // Nothing was written by the rejected calls beyond the seed.
  const balance = await balanceOf(userId);
  assert.equal(balance.purchasedCredits, 10);
});

test("single-bucket operations reject malformed bucket shapes with zero balance/ledger writes", async () => {
  await resetSyntheticData();
  const userId = await createUser("admin-bad-bucket");
  await grantPurchasedCredits({ userId, amount: 10, note: "seed" });
  await resetSubscriptionCredits({ userId, amount: 5, note: "seed" });

  const balanceBefore = await balanceOf(userId);
  const noteCountBefore = (await notesOf(userId)).length;

  // Array would coerce to a real bucket via JS property-key coercion; object,
  // null, undefined and an unknown string must all be rejected too.
  const badBuckets: unknown[] = [
    ["purchased"],
    ["subscription"],
    { bucket: "purchased" },
    null,
    undefined,
    "purchased-extra",
    0,
  ];

  for (const bucket of badBuckets) {
    await assert.rejects(
      () =>
        addCredits({
          userId,
          bucket: bucket as never,
          amount: 3,
          actorUserId: ACTOR,
          reason: "bad bucket",
        }),
      /bucket must be/,
    );
  }

  // No balance or ledger change for any rejected bucket.
  assert.deepEqual(await balanceOf(userId), balanceBefore);
  assert.equal((await notesOf(userId)).length, noteCountBefore);
});
