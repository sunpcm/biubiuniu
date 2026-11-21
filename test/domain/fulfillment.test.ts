import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { closeDatabase, db } from "@/lib/db";
import { user as userTable, orders, subscriptions } from "@/lib/db/schema";
import { PermanentFulfillmentError } from "@/lib/billing/fulfillment";
import { createDomainCommerce } from "./commerce-assembly";
import type { OneTimePaymentInput } from "@/lib/billing/types";
import { eq } from "drizzle-orm";
import { migrate, resetSyntheticData } from "./helpers";

const domain = createDomainCommerce();
const { applyRefund, fulfillOneTimePurchase, recordPendingOneTimePurchase, syncSubscription } =
  domain.fulfillment;

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

function oneTimeInput(
  overrides: Partial<OneTimePaymentInput> & Pick<OneTimePaymentInput, "providerOrderId">,
): OneTimePaymentInput {
  return {
    provider: "stripe",
    subject: {
      userId: overrides.subject?.userId ?? null,
      organizationId: overrides.subject?.organizationId ?? null,
    },
    planId: "credit-pack-100",
    credits: 100,
    amountTotal: 1000,
    currency: "usd",
    providerOrderId: overrides.providerOrderId,
    ...overrides,
  };
}

before(async () => {
  await migrate();
});

after(async () => {
  await closeDatabase();
});

test("SR03: a mismatched subject cannot promote and steal a pending order", async () => {
  await resetSyntheticData();
  const userA = await createUser("sr03-a");
  const userB = await createUser("sr03-b");
  const providerOrderId = `sr03-${crypto.randomUUID()}`;

  // A pending trace row is recorded for subject A.
  await db.insert(orders).values({
    userId: userA,
    organizationId: null,
    planId: "credit-pack-100",
    orderType: "one_time",
    status: "pending",
    creditsGranted: 0,
    amountTotal: 1000,
    currency: "usd",
    provider: "stripe",
    providerOrderId,
  });

  // The settled event arrives for a DIFFERENT subject B, same idempotency key.
  await assert.rejects(
    () =>
      fulfillOneTimePurchase(
        oneTimeInput({
          providerOrderId,
          subject: { userId: userB, organizationId: null },
        }),
      ),
    PermanentFulfillmentError,
  );

  // The order stays pending and B received no credits.
  const [order] = await db
    .select({ status: orders.status, userId: orders.userId })
    .from(orders)
    .where(eq(orders.providerOrderId, providerOrderId));
  assert.equal(order.status, "pending");
  assert.equal(order.userId, userA);

  const getUserCredits = domain.credits.getUserCredits;
  assert.equal((await getUserCredits(userB)).totalCredits, 0);
});

test("SR03: a mismatched plan id is rejected on promotion", async () => {
  await resetSyntheticData();
  const userA = await createUser("sr03-plan");
  const providerOrderId = `sr03-plan-${crypto.randomUUID()}`;

  await db.insert(orders).values({
    userId: userA,
    organizationId: null,
    planId: "credit-pack-100",
    orderType: "one_time",
    status: "pending",
    creditsGranted: 0,
    amountTotal: 1000,
    currency: "usd",
    provider: "stripe",
    providerOrderId,
  });

  await assert.rejects(
    () =>
      fulfillOneTimePurchase(
        oneTimeInput({
          providerOrderId,
          planId: "credit-pack-500",
          subject: { userId: userA, organizationId: null },
        }),
      ),
    PermanentFulfillmentError,
  );
});

test("A10: an already-completed order replays as a no-op", async () => {
  await resetSyntheticData();
  const userA = await createUser("sr03-replay");
  const providerOrderId = `sr03-replay-${crypto.randomUUID()}`;

  await db.insert(orders).values({
    userId: userA,
    organizationId: null,
    planId: "credit-pack-100",
    orderType: "one_time",
    status: "completed",
    creditsGranted: 100,
    amountTotal: 1000,
    currency: "usd",
    provider: "stripe",
    providerOrderId,
  });

  // A replay of a completed order must not grant a second time. The after()
  // notification is not reached because `created` is false.
  const result = await fulfillOneTimePurchase(
    oneTimeInput({
      providerOrderId,
      subject: { userId: userA, organizationId: null },
    }),
  );
  assert.equal(result.created, false);

  const getUserCredits = domain.credits.getUserCredits;
  assert.equal((await getUserCredits(userA)).purchasedCredits, 0);
});

test("SR03: pending → completed promotion grants exactly once and replays as a no-op", async () => {
  await resetSyntheticData();
  const userA = await createUser("sr03-promote");
  const providerOrderId = `sr03-promote-${crypto.randomUUID()}`;

  await recordPendingOneTimePurchase(
    oneTimeInput({
      providerOrderId,
      subject: { userId: userA, organizationId: null },
      credits: 100,
    }),
  );

  const result = await fulfillOneTimePurchase(
    oneTimeInput({
      providerOrderId,
      subject: { userId: userA, organizationId: null },
      credits: 100,
    }),
  );
  assert.equal(result.created, true);

  const [order] = await db
    .select({ status: orders.status, creditsGranted: orders.creditsGranted })
    .from(orders)
    .where(eq(orders.providerOrderId, providerOrderId));
  assert.equal(order.status, "completed");
  assert.equal(order.creditsGranted, 100);

  const getUserCredits = domain.credits.getUserCredits;
  assert.equal((await getUserCredits(userA)).purchasedCredits, 100);

  // A replay of the completed order grants nothing more.
  const replay = await fulfillOneTimePurchase(
    oneTimeInput({
      providerOrderId,
      subject: { userId: userA, organizationId: null },
      credits: 100,
    }),
  );
  assert.equal(replay.created, false);
  assert.equal((await getUserCredits(userA)).purchasedCredits, 100);
});

test("SR03: concurrent promotions of one pending order grant exactly once", async () => {
  await resetSyntheticData();
  const userA = await createUser("sr03-concurrent");
  const providerOrderId = `sr03-concurrent-${crypto.randomUUID()}`;

  await recordPendingOneTimePurchase(
    oneTimeInput({
      providerOrderId,
      subject: { userId: userA, organizationId: null },
      credits: 100,
    }),
  );

  const outcomes = await Promise.allSettled(
    Array.from({ length: 5 }, () =>
      fulfillOneTimePurchase(
        oneTimeInput({
          providerOrderId,
          subject: { userId: userA, organizationId: null },
          credits: 100,
        }),
      ),
    ),
  );
  const created = outcomes.filter((r) => r.status === "fulfilled" && r.value.created).length;
  assert.equal(created, 1);

  const getUserCredits = domain.credits.getUserCredits;
  assert.equal((await getUserCredits(userA)).purchasedCredits, 100);
});

test("refund: cumulative partial then full replay claws back proportionally and stays idempotent", async () => {
  await resetSyntheticData();
  const userA = await createUser("sr03-refund");
  const providerOrderId = `sr03-refund-${crypto.randomUUID()}`;

  await fulfillOneTimePurchase(
    oneTimeInput({
      providerOrderId,
      subject: { userId: userA, organizationId: null },
      credits: 100,
      amountTotal: 1000,
    }),
  );

  const getUserCredits = domain.credits.getUserCredits;
  assert.equal((await getUserCredits(userA)).purchasedCredits, 100);

  // Partial refund: 500/1000 → 50 of 100 credits revoked.
  await applyRefund({ provider: "stripe", providerOrderId, amountRefunded: 500 });
  assert.equal((await getUserCredits(userA)).purchasedCredits, 50);

  const [partial] = await db
    .select({ status: orders.status, amountRefunded: orders.amountRefunded })
    .from(orders)
    .where(eq(orders.providerOrderId, providerOrderId));
  assert.equal(partial.status, "partially_refunded");
  assert.equal(partial.amountRefunded, 500);

  // Full refund: cumulative 1000 → the remaining 50 revoked, order refunded.
  await applyRefund({ provider: "stripe", providerOrderId, amountRefunded: 1000 });
  assert.equal((await getUserCredits(userA)).purchasedCredits, 0);

  const [full] = await db
    .select({ status: orders.status, amountRefunded: orders.amountRefunded })
    .from(orders)
    .where(eq(orders.providerOrderId, providerOrderId));
  assert.equal(full.status, "refunded");
  assert.equal(full.amountRefunded, 1000);

  // Replay is a no-op — credits are never clawed back a second time.
  await applyRefund({ provider: "stripe", providerOrderId, amountRefunded: 1000 });
  assert.equal((await getUserCredits(userA)).purchasedCredits, 0);
});

test("BR01: cumulative refund watermark never claws back more than granted (3 credits / 100)", async () => {
  await resetSyntheticData();
  const userA = await createUser("br01-split");
  const providerOrderId = `br01-split-${crypto.randomUUID()}`;

  // Unrelated purchased balance that rounding must not erode.
  const grantPurchasedCredits = domain.ledger.grantPurchasedCredits;
  await grantPurchasedCredits({ userId: userA, amount: 10, note: "unrelated" });

  await fulfillOneTimePurchase(
    oneTimeInput({
      providerOrderId,
      subject: { userId: userA, organizationId: null },
      credits: 3,
      amountTotal: 100,
    }),
  );

  const getUserCredits = domain.credits.getUserCredits;
  assert.equal((await getUserCredits(userA)).purchasedCredits, 13);

  // Refund 50, then 100 (cumulative). Per-delta rounding would claw 2 + 2 = 4.
  await applyRefund({ provider: "stripe", providerOrderId, amountRefunded: 50 });
  await applyRefund({ provider: "stripe", providerOrderId, amountRefunded: 100 });

  // Exactly the 3 granted credits were clawed back; the unrelated 10 survive.
  assert.equal((await getUserCredits(userA)).purchasedCredits, 10);
});

test("BR01: a single full refund claws back the same total as split refunds", async () => {
  await resetSyntheticData();
  const userA = await createUser("br01-full");
  const providerOrderId = `br01-full-${crypto.randomUUID()}`;

  const grantPurchasedCredits = domain.ledger.grantPurchasedCredits;
  await grantPurchasedCredits({ userId: userA, amount: 10, note: "unrelated" });

  await fulfillOneTimePurchase(
    oneTimeInput({
      providerOrderId,
      subject: { userId: userA, organizationId: null },
      credits: 3,
      amountTotal: 100,
    }),
  );

  const getUserCredits = domain.credits.getUserCredits;
  assert.equal((await getUserCredits(userA)).purchasedCredits, 13);

  // One full refund, no intermediate partial refund.
  await applyRefund({ provider: "stripe", providerOrderId, amountRefunded: 100 });

  assert.equal((await getUserCredits(userA)).purchasedCredits, 10);
});

test("SR04: over-refund (refunded > order total) is rejected and writes nothing", async () => {
  await resetSyntheticData();
  const userA = await createUser("sr04-over");
  const providerOrderId = `sr04-over-${crypto.randomUUID()}`;

  // Unrelated purchased balance that an over-refund must never erode.
  const grantPurchasedCredits = domain.ledger.grantPurchasedCredits;
  await grantPurchasedCredits({ userId: userA, amount: 10, note: "unrelated" });

  await fulfillOneTimePurchase(
    oneTimeInput({
      providerOrderId,
      subject: { userId: userA, organizationId: null },
      credits: 100,
      amountTotal: 100,
    }),
  );

  const getUserCredits = domain.credits.getUserCredits;
  assert.equal((await getUserCredits(userA)).purchasedCredits, 110);

  // A 1.5x cumulative refund (150 on a 100 order) must be rejected, not
  // clawed back into unrelated balance.
  await assert.rejects(
    () =>
      applyRefund({
        provider: "stripe",
        providerOrderId,
        amountRefunded: 150,
      }),
    /exceeds order total/,
  );

  const [order] = await db
    .select({ status: orders.status, amountRefunded: orders.amountRefunded })
    .from(orders)
    .where(eq(orders.providerOrderId, providerOrderId));
  assert.equal(order.status, "completed");
  assert.equal(order.amountRefunded, 0);
  assert.equal((await getUserCredits(userA)).purchasedCredits, 110);
});

test("SR04: malformed refund amounts (NaN/Infinity/non-integer/negative) write nothing", async () => {
  await resetSyntheticData();
  const userA = await createUser("sr04-malformed");
  const providerOrderId = `sr04-malformed-${crypto.randomUUID()}`;

  await fulfillOneTimePurchase(
    oneTimeInput({
      providerOrderId,
      subject: { userId: userA, organizationId: null },
      credits: 100,
      amountTotal: 1000,
    }),
  );

  const getUserCredits = domain.credits.getUserCredits;
  const before = await getUserCredits(userA);

  for (const amount of [NaN, Infinity, 1.5, -50]) {
    await assert.rejects(
      () =>
        applyRefund({
          provider: "stripe",
          providerOrderId,
          amountRefunded: amount,
        }),
      /safe integer|non-negative/,
    );
  }

  assert.equal((await getUserCredits(userA)).purchasedCredits, before.purchasedCredits);

  const [order] = await db
    .select({ amountRefunded: orders.amountRefunded })
    .from(orders)
    .where(eq(orders.providerOrderId, providerOrderId));
  assert.equal(order.amountRefunded, 0);
});

test("terminal subscription is not resurrected by a late live-status sync", async () => {
  await resetSyntheticData();
  const userA = await createUser("terminal-sub");
  const providerSubscriptionId = `sub-${crypto.randomUUID()}`;

  await db.insert(subscriptions).values({
    userId: userA,
    organizationId: null,
    planId: "starter-monthly",
    provider: "stripe",
    providerSubscriptionId,
    status: "canceled",
    interval: "month",
    monthlyCredits: 500,
  });

  await syncSubscription({
    provider: "stripe",
    providerSubscriptionId,
    subject: { userId: userA, organizationId: null },
    planId: "starter-monthly",
    status: "active",
    interval: "month",
    monthlyCredits: 500,
  });

  const [row] = await db
    .select({ status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
  assert.equal(row.status, "canceled");
});
