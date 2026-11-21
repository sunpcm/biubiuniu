import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { closeDatabase, db } from "@/lib/db";
import { user as userTable, orders } from "@/lib/db/schema";
import { resolveCreemPlan } from "@/lib/billing/creem";
import { resolvePayPalPlan } from "@/lib/billing/paypal";
import { createDomainCommerce } from "./commerce-assembly";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { migrate, resetSyntheticData } from "./helpers";

const domain = createDomainCommerce({
  purchasesEnabled: true,
  notifier: {
    onOrderCommitted: async () => {},
    onDuplicateSubscription: async () => {},
    onPaymentDenied: async () => {},
    onDispute: async () => {},
  },
});
const { fulfillCheckoutSession, resolvePlan } = domain.stripe;
const stripe = new Stripe("sk_test_source_identity_fixture");
const webhookSecret = "fixture-only";
const stripeDeps = { client: stripe, webhookSecret };

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

function checkoutSession(overrides: {
  userId: string;
  planId: string;
  priceId: string;
  id?: string;
}): Stripe.Checkout.Session {
  return {
    id: overrides.id ?? `cs_${crypto.randomUUID()}`,
    object: "checkout.session",
    mode: "payment",
    payment_status: "paid",
    customer: "cus_fixture",
    payment_intent: "pi_fixture",
    amount_total: 590,
    amount_subtotal: 590,
    total_details: { amount_discount: 0, amount_tax: 0 },
    currency: "usd",
    metadata: { userId: overrides.userId, planId: overrides.planId },
    line_items: { data: [{ price: { id: overrides.priceId }, quantity: 1 }] },
  } as unknown as Stripe.Checkout.Session;
}

before(async () => {
  await migrate();
});

after(async () => {
  await closeDatabase();
});

test("source identity: external price id wins and conflicts are rejected", () => {
  // metadata names pack-mini, external price resolves to pack-standard → reject.
  assert.equal(
    resolvePlan({
      metadata: { planId: "pack-mini" },
      priceId: "price_REPLACE_pack_standard_test",
    }),
    null,
  );
  // metadata names pack-mini, external price is a foreign/unknown id → reject.
  assert.equal(resolvePlan({ metadata: { planId: "pack-mini" }, priceId: "price_foreign" }), null);
  // metadata and external price agree → resolve the authoritative plan.
  assert.equal(
    resolvePlan({
      metadata: { planId: "pack-mini" },
      priceId: "price_REPLACE_pack_mini_test",
    })?.id,
    "pack-mini",
  );
  // Bare metadata is never legacy proof.
  assert.equal(resolvePlan({ metadata: { planId: "pack-mini" }, priceId: null }), null);
});

test("source identity: Creem and PayPal foreign external ids are rejected", () => {
  // No Creem/PayPal plan exists in the current catalog, so any present-but-
  // unknown external product/plan id is a foreign source and must not fall
  // back to metadata.
  assert.equal(
    resolveCreemPlan({
      metadata: { planId: "starter-monthly" },
      productId: "prod_foreign",
    }),
    null,
  );
  assert.equal(resolvePayPalPlan("starter-monthly", "P-foreign"), null);
  // Cross-provider metadata (a Stripe plan named in a PayPal/Creem event) also
  // resolves to null, never routing another provider's plan into this ledger.
  assert.equal(resolveCreemPlan({ metadata: { planId: "starter-monthly" } }), null);
  assert.equal(resolvePayPalPlan("starter-monthly"), null);
});

test("fulfillCheckoutSession grants once for an attributed source", async () => {
  await resetSyntheticData();
  const userA = await createUser("src-ok");
  const session = checkoutSession({
    userId: userA,
    planId: "pack-mini",
    priceId: "price_REPLACE_pack_mini_test",
  });

  await fulfillCheckoutSession(session, stripeDeps);

  assert.equal((await domain.credits.getUserCredits(userA)).purchasedCredits, 300);

  // Replay is idempotent (no second grant).
  await fulfillCheckoutSession(session, stripeDeps);
  assert.equal((await domain.credits.getUserCredits(userA)).purchasedCredits, 300);
});

test("fulfillCheckoutSession rejects a conflicting source with zero write", async () => {
  await resetSyntheticData();
  const userA = await createUser("src-conflict");
  const session = checkoutSession({
    userId: userA,
    planId: "pack-mini",
    priceId: "price_REPLACE_pack_standard_test",
  });

  await assert.rejects(
    () => fulfillCheckoutSession(session, stripeDeps),
    /Cannot resolve credit pack plan/,
  );

  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.providerOrderId, session.id));
  assert.equal(rows.length, 0);

  assert.equal((await domain.credits.getUserCredits(userA)).totalCredits, 0);
});

test("checkout lookup returns the complete owner contract and rejects a foreign user", async () => {
  await resetSyntheticData();
  const owner = await createUser("lookup-owner");
  const other = await createUser("lookup-other");
  const session = checkoutSession({
    id: `cs_${crypto.randomUUID()}`,
    userId: owner,
    planId: "pack-mini",
    priceId: "price_REPLACE_pack_mini_test",
  });
  const result = await domain.stripe.fulfillCheckoutSessionById(session.id, owner, {
    ...stripeDeps,
    getSession: async () => session,
  });
  assert.deepEqual(result, {
    paid: true,
    failed: false,
    userId: owner,
    planId: "pack-mini",
  });
  assert.equal((await domain.credits.getUserCredits(owner)).purchasedCredits, 300);

  const foreign = await domain.stripe.fulfillCheckoutSessionById(session.id, other, {
    ...stripeDeps,
    getSession: async () => session,
  });
  assert.deepEqual(foreign, {
    paid: true,
    failed: true,
    userId: owner,
    planId: "pack-mini",
  });
  assert.equal((await domain.credits.getUserCredits(other)).totalCredits, 0);

  const customerId = `cus_${crypto.randomUUID()}`;
  await db.update(userTable).set({ stripeCustomerId: customerId }).where(eq(userTable.id, owner));
  const withoutMetadata = {
    ...session,
    customer: customerId,
    metadata: {},
  } as Stripe.Checkout.Session;
  const customerMapped = await domain.stripe.fulfillCheckoutSessionById(session.id, other, {
    ...stripeDeps,
    getSession: async () => withoutMetadata,
  });
  assert.deepEqual(customerMapped, {
    paid: true,
    failed: true,
    userId: owner,
    planId: "pack-mini",
  });
  assert.equal(
    (await db.select({ id: orders.id }).from(orders).where(eq(orders.providerOrderId, session.id)))
      .length,
    1,
  );
});
