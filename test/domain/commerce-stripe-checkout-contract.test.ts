import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import type { AppCommerce } from "@/composition/commerce";
import type { PricingPlan } from "@/config/pricing";
import { createStripeBilling } from "@/lib/billing/stripe";
import { buildSourceIdentityCatalog, resolvePlanBySource } from "@/lib/pricing/source-identity";

const plan: PricingPlan = {
  id: "pack-contract",
  provider: "stripe",
  kind: "credit_pack",
  price: 10,
  currency: "USD",
  credits: 100,
  active: true,
  stripePriceId: {
    test: "price_contract",
    live: "price_contract_live",
  },
  copy: { en: { name: "Contract pack", description: "", features: [] } },
};
const catalog = buildSourceIdentityCatalog([plan]);
const webhookClient = {
  webhooks: {
    constructEvent() {
      throw new Error("Webhook verification is not used by this lookup fixture");
    },
  },
} as unknown as Pick<Stripe, "webhooks">;

function fixture() {
  let fulfilled: unknown = null;
  const app = {
    commerce: {
      runtime: {
        catalog,
        withUnit: async (
          _outer: unknown,
          run: (unit: {
            identity: {
              findUserIdByProviderCustomer(): Promise<string | null>;
            };
          }) => Promise<unknown>,
        ) => run({ identity: { findUserIdByProviderCustomer: async () => "owner" } }),
      },
      resolvePlanBySource,
      resolveSubject: async ({
        userId,
      }: {
        userId?: string | null;
        organizationId?: string | null;
      }) => ({
        userId: userId ?? null,
        organizationId: null,
      }),
      fulfillOneTimePurchase: async (input: unknown) => {
        fulfilled = input;
        return { created: true };
      },
    },
    store: {},
  } as unknown as AppCommerce;
  return {
    billing: createStripeBilling(app),
    fulfilled: () => fulfilled,
  };
}

function session(metadata: Stripe.Metadata): Stripe.Checkout.Session {
  return {
    id: "cs_contract",
    object: "checkout.session",
    mode: "payment",
    payment_status: "paid",
    customer: "cus_owner",
    payment_intent: "pi_contract",
    amount_total: 1000,
    amount_subtotal: 1000,
    total_details: { amount_discount: 0, amount_tax: 0 },
    currency: "usd",
    metadata,
    line_items: {
      data: [{ price: { id: "price_contract" }, quantity: 1 }],
      has_more: false,
    },
  } as unknown as Stripe.Checkout.Session;
}

test("Stripe by-id fulfillment returns the full owner contract and fulfills once", async () => {
  const current = fixture();
  const result = await current.billing.fulfillCheckoutSessionById("cs_contract", "owner", {
    client: webhookClient,
    getSession: async () => session({ userId: "owner", planId: plan.id }),
    webhookSecret: "unused-contract-secret",
  });

  assert.deepEqual(result, {
    paid: true,
    failed: false,
    userId: "owner",
    planId: plan.id,
  });
  assert.ok(current.fulfilled());
  assert.equal((current.fulfilled() as { providerOrderId: string }).providerOrderId, "cs_contract");
});

test("Stripe by-id fulfillment rejects metadata and customer ownership conflicts before money moves", async () => {
  for (const metadata of [{ userId: "owner", planId: plan.id }, { planId: plan.id }]) {
    const current = fixture();
    const result = await current.billing.fulfillCheckoutSessionById("cs_contract", "other", {
      client: webhookClient,
      getSession: async () => session(metadata),
      webhookSecret: "unused-contract-secret",
    });
    assert.deepEqual(result, {
      paid: true,
      failed: true,
      userId: "owner",
      planId: plan.id,
    });
    assert.equal(current.fulfilled(), null);
  }
});

test("Stripe by-id rejects a metadata owner that conflicts with the bound customer", async () => {
  const current = fixture();

  await assert.rejects(
    () =>
      current.billing.fulfillCheckoutSessionById("cs_contract", "other", {
        client: webhookClient,
        getSession: async () => session({ userId: "other", planId: plan.id }),
        webhookSecret: "unused-contract-secret",
      }),
    /ownership conflict/,
  );
  assert.equal(current.fulfilled(), null);
});

test("Stripe by-id fulfillment rejects an unknown external source without falling back to metadata", async () => {
  const current = fixture();
  const unknown = session({ userId: "owner", planId: plan.id });
  unknown.line_items = {
    data: [{ price: { id: "price_foreign" }, quantity: 1 }],
    has_more: false,
  };

  await assert.rejects(
    () =>
      current.billing.fulfillCheckoutSessionById("cs_contract", "owner", {
        client: webhookClient,
        getSession: async () => unknown,
        webhookSecret: "unused-contract-secret",
      }),
    /Cannot resolve credit pack plan/,
  );
  assert.equal(current.fulfilled(), null);
});
