import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { closeDatabase, db } from "@/lib/db";
import { user as userTable } from "@/lib/db/schema";
import { InsufficientCreditsError } from "@/lib/credits/ledger";
import { migrate, resetSyntheticData } from "./helpers";
import { createDomainCommerce } from "./commerce-assembly";
import { eq } from "drizzle-orm";

const domain = createDomainCommerce();
const {
  grantPurchasedCredits,
  grantSignupBonusCredits,
  spendCredits,
  adjustCredits,
  refundSpentCredits,
} = domain.ledger;

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
  const { getUserCredits } = domain.credits;
  return getUserCredits(userId);
}

before(async () => {
  await migrate();
});

after(async () => {
  await closeDatabase();
});

test("SR02: spendCredits rejects negative, zero, NaN, Infinity, non-integer and out-of-range amounts without writing", async () => {
  await resetSyntheticData();
  const userId = await createUser("sr02-spend");
  await grantPurchasedCredits({ userId, amount: 50, note: "seed" });

  const beforeBalance = await balanceOf(userId);
  const invalidAmounts: unknown[] = [-5, 0, NaN, Infinity, 1.5, 2147483648];
  for (const amount of invalidAmounts) {
    await assert.rejects(
      () => spendCredits({ userId, amount: amount as number, note: "bad" }),
      /safe integer|non-negative|non-zero|PostgreSQL integer range/,
    );
  }

  const afterBalance = await balanceOf(userId);
  assert.equal(afterBalance.totalCredits, beforeBalance.totalCredits);
  // No usage ledger row was written for any rejected input.
  const { creditTransactions } = await import("@/lib/db/schema");
  const rows = await db.select({ id: creditTransactions.id }).from(creditTransactions);
  assert.equal(rows.length, 1); // only the seed purchase
});

test("SR02: grantPurchasedCredits and adjustCredits reject invalid amounts", async () => {
  await resetSyntheticData();
  const userId = await createUser("sr02-grant");

  await assert.rejects(
    () => grantPurchasedCredits({ userId, amount: -10, note: "bad" }),
    /safe integer|non-negative/,
  );
  await assert.rejects(() => adjustCredits({ userId, delta: 1.5, note: "bad" }), /safe integer/);
  await assert.rejects(() => adjustCredits({ userId, delta: NaN, note: "bad" }), /safe integer/);
});

test("SR01: concurrent signup bonus grants at most one bonus and one amount", async () => {
  await resetSyntheticData();
  const userId = await createUser("sr01-bonus");

  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () =>
      grantSignupBonusCredits({ userId, amount: 30, note: "welcome" }),
    ),
  );
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  assert.equal(fulfilled.length, 6);

  const b = await balanceOf(userId);
  assert.equal(b.purchasedCredits, 30);
  assert.equal(b.totalCredits, 30);
});

test("A13: concurrent spend drains exactly once and never goes negative", async () => {
  await resetSyntheticData();
  const userId = await createUser("a13-spend");
  await grantPurchasedCredits({ userId, amount: 100, note: "seed" });

  const outcomes = await Promise.allSettled(
    Array.from({ length: 100 }, () => spendCredits({ userId, amount: 2, note: "spend" })),
  );
  const ok = outcomes.filter((r) => r.status === "fulfilled").length;
  const insufficient = outcomes.filter(
    (r) => r.status === "rejected" && r.reason instanceof InsufficientCreditsError,
  ).length;

  assert.equal(ok, 50);
  assert.equal(insufficient, 50);

  const b = await balanceOf(userId);
  assert.equal(b.subscriptionCredits, 0);
  assert.equal(b.purchasedCredits, 0);
  assert.equal(b.totalCredits, 0);
});

test("A36: personal, team and other-team pools never mix", async () => {
  await resetSyntheticData();
  const a = await createUser("a36-a");
  const b = await createUser("a36-b");
  const { organization, member } = await import("@/lib/db/schema");

  const [org] = await db
    .insert(organization)
    .values({ name: "Team A", slug: `team-a-${crypto.randomUUID()}` })
    .returning({ id: organization.id });
  await db.insert(member).values({ organizationId: org.id, userId: a, role: "owner" });

  await grantPurchasedCredits({ userId: a, amount: 10, note: "personal" });
  await grantPurchasedCredits({
    userId: a,
    organizationId: org.id,
    amount: 100,
    note: "team",
  });

  const personal = await balanceOf(a);
  const { getOrganizationCredits } = domain.credits;
  const team = await getOrganizationCredits(org.id);
  const other = await balanceOf(b);

  assert.equal(personal.totalCredits, 10);
  assert.equal(team.totalCredits, 100);
  assert.equal(other.totalCredits, 0);

  // Spending from the team pool does not touch the personal pool or another user.
  await spendCredits({ userId: a, organizationId: org.id, amount: 3, note: "team spend" });
  assert.equal((await getOrganizationCredits(org.id)).totalCredits, 97);
  assert.equal((await balanceOf(a)).totalCredits, 10);
  assert.equal((await balanceOf(b)).totalCredits, 0);
});

test("refundSpentCredits returns a failed task credits to the original bucket and replays as a no-op", async () => {
  await resetSyntheticData();
  const userId = await createUser("refund-spend");
  await grantPurchasedCredits({ userId, amount: 100, note: "seed" });

  const spend = await spendCredits({ userId, amount: 30, note: "usage" });
  assert.equal(spend.spentFromPurchased, 30);
  assert.equal((await balanceOf(userId)).purchasedCredits, 70);

  await refundSpentCredits({ userId, spendTxId: spend.txId, note: "task failed" });
  assert.equal((await balanceOf(userId)).purchasedCredits, 100);

  // Replay is idempotent — a usage row is refunded at most once.
  await refundSpentCredits({ userId, spendTxId: spend.txId, note: "replay" });
  assert.equal((await balanceOf(userId)).purchasedCredits, 100);
});

test("yearly drip: batch settles one month and concurrent triggers collapse to one grant", async () => {
  await resetSyntheticData();
  const userId = await createUser("drip");
  const { subscriptions } = await import("@/lib/db/schema");

  const past = new Date(Date.now() - 60 * 60 * 1000);
  const [sub] = await db
    .insert(subscriptions)
    .values({
      userId,
      organizationId: null,
      planId: "yearly-plan",
      provider: "stripe",
      providerSubscriptionId: `sub-${crypto.randomUUID()}`,
      status: "active",
      interval: "year",
      monthlyCredits: 100,
      remainingGrants: 11,
      nextGrantAt: past,
    })
    .returning({ id: subscriptions.id });

  const { settleDueDripGrantsBatch, settleDripForSubscription } = domain.credits;

  const batch = await settleDueDripGrantsBatch(10);
  assert.equal(batch.settled, 1);

  const [afterBatch] = await db
    .select({ remainingGrants: subscriptions.remainingGrants })
    .from(subscriptions)
    .where(eq(subscriptions.id, sub.id));
  assert.equal(afterBatch.remainingGrants, 10);

  // Make the next grant due again, then race 5 concurrent triggers.
  await db
    .update(subscriptions)
    .set({ nextGrantAt: new Date(Date.now() - 60 * 60 * 1000) })
    .where(eq(subscriptions.id, sub.id));

  await Promise.allSettled(Array.from({ length: 5 }, () => settleDripForSubscription(sub.id)));

  const [afterRace] = await db
    .select({ remainingGrants: subscriptions.remainingGrants })
    .from(subscriptions)
    .where(eq(subscriptions.id, sub.id));
  assert.equal(afterRace.remainingGrants, 9);
});
