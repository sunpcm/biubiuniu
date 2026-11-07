import assert from "node:assert/strict";
import test from "node:test";
import type { AppCommerce } from "@/composition/commerce";
import type { PricingPlan } from "@/config/pricing";
import { createCreemBilling } from "@/lib/billing/creem";
import { buildSourceIdentityCatalog, resolvePlanBySource } from "@/lib/pricing/source-identity";

const plan: PricingPlan = {
  id: "creem-pack-contract",
  provider: "creem",
  kind: "credit_pack",
  price: 10,
  currency: "USD",
  credits: 100,
  active: true,
  creemProductId: {
    test: "prod_contract",
    live: "prod_contract_live",
  },
  copy: { en: { name: "Creem contract pack", description: "", features: [] } },
};
const subscriptionPlan: PricingPlan = {
  id: "creem-subscription-contract",
  provider: "creem",
  kind: "subscription",
  interval: "month",
  price: 10,
  currency: "USD",
  monthlyCredits: 100,
  active: true,
  creemProductId: {
    test: "prod_subscription_contract",
    live: "prod_subscription_contract_live",
  },
  copy: { en: { name: "Creem contract subscription", description: "", features: [] } },
};
const catalog = buildSourceIdentityCatalog([plan, subscriptionPlan]);

function fixture(params: { livingUsers?: string[]; customerOwners?: Record<string, string> }) {
  const living = new Set(params.livingUsers ?? []);
  const customerOwners = params.customerOwners ?? {};
  let fulfilled: Record<string, unknown> | null = null;
  let synced: Record<string, unknown> | null = null;

  const app = {
    commerce: {
      runtime: {
        catalog,
        deps: { clock: { now: () => new Date("2026-11-07T00:00:00.000Z") } },
        log() {},
        withUnit: async (
          _outer: unknown,
          run: (unit: {
            identity: {
              findUserIdByProviderCustomer(
                provider: string,
                customerId: string,
              ): Promise<string | null>;
              writeProviderCustomerIfAbsent(
                userId: string,
                provider: string,
                customerId: string,
                at: Date,
              ): Promise<"written" | "same" | "conflict" | "missing">;
            };
          }) => Promise<unknown>,
        ) =>
          run({
            identity: {
              findUserIdByProviderCustomer: async (provider, customerId) =>
                provider === "creem" ? (customerOwners[customerId] ?? null) : null,
              writeProviderCustomerIfAbsent: async () => "written",
            },
          }),
      },
      resolvePlanBySource,
      resolveSubscriptionSource: async ({ externalId }: { externalId?: string | null }) =>
        externalId === "prod_subscription_contract"
          ? {
              plan: subscriptionPlan,
              subject: null,
              providerPriceId: externalId,
            }
          : null,
      resolveValidUserId: async (candidate?: string | null) =>
        candidate && living.has(candidate) ? candidate : null,
      resolveValidOrganizationId: async (candidate?: string | null) =>
        candidate === "org_contract" ? candidate : null,
      resolveSubject: async ({
        userId,
        organizationId,
      }: {
        userId?: string | null;
        organizationId?: string | null;
      }) => ({
        userId: userId && living.has(userId) ? userId : null,
        organizationId: organizationId === "org_contract" ? organizationId : null,
      }),
      fulfillOneTimePurchase: async (input: Record<string, unknown>) => {
        fulfilled = input;
        return { created: true };
      },
      syncSubscription: async (input: Record<string, unknown>) => {
        synced = input;
      },
    },
    store: {},
  } as unknown as AppCommerce;

  return {
    billing: createCreemBilling(app),
    fulfilled: () => fulfilled,
    synced: () => synced,
  };
}

function checkout(metadata: Record<string, unknown>, customer = "creem_customer_owner") {
  return {
    id: "checkout_contract",
    mode: "test",
    object: "checkout",
    status: "completed",
    product: "prod_contract",
    customer,
    metadata,
    order: {
      id: "order_contract",
      mode: "test",
      object: "order",
      product: "prod_contract",
      transaction: "transaction_contract",
      amount: 1000,
      amountPaid: 1000,
      currency: "USD",
      status: "paid",
      type: "onetime",
    },
  };
}

test("Creem by-id fulfillment returns the full owner contract and fulfills once", async () => {
  const current = fixture({
    livingUsers: ["owner"],
    customerOwners: { creem_customer_owner: "owner" },
  });
  const result = await current.billing.fulfillCreemCheckoutById("checkout_contract", "owner", {
    catalog,
    getCheckout: async () => checkout({ userId: "owner", planId: plan.id }),
  });

  assert.deepEqual(result, {
    paid: true,
    planId: plan.id,
    userId: "owner",
  });
  assert.equal(current.fulfilled()?.providerOrderId, "order_contract");
});

test("Creem by-id subscription checkout synchronizes under the checked owner", async () => {
  const current = fixture({
    livingUsers: ["owner"],
    customerOwners: { creem_customer_owner: "owner" },
  });
  const result = await current.billing.fulfillCreemCheckoutById("checkout_contract", "owner", {
    catalog,
    getCheckout: async () => ({
      id: "checkout_contract",
      mode: "test",
      object: "checkout",
      status: "completed",
      product: "prod_subscription_contract",
      customer: "creem_customer_owner",
      metadata: { userId: "owner", planId: subscriptionPlan.id },
      subscription: {
        id: "subscription_contract",
        status: "active",
        product: "prod_subscription_contract",
        customer: "creem_customer_owner",
        metadata: {},
        currentPeriodStartDate: new Date("2026-11-01T00:00:00.000Z"),
        currentPeriodEndDate: new Date("2026-12-01T00:00:00.000Z"),
      },
    }),
  });

  assert.deepEqual(result, {
    paid: true,
    planId: subscriptionPlan.id,
    userId: "owner",
  });
  assert.equal(current.fulfilled(), null);
  assert.deepEqual(current.synced()?.subject, {
    userId: "owner",
    organizationId: null,
  });
  assert.equal(current.synced()?.providerSubscriptionId, "subscription_contract");
});

test("Creem by-id resolves a missing metadata owner only through the persisted customer binding", async () => {
  const current = fixture({
    livingUsers: ["owner"],
    customerOwners: { creem_customer_owner: "owner" },
  });
  const result = await current.billing.fulfillCreemCheckoutById("checkout_contract", "owner", {
    catalog,
    getCheckout: async () => checkout({ planId: plan.id }),
  });

  assert.deepEqual(result, {
    paid: true,
    planId: plan.id,
    userId: "owner",
  });
  assert.deepEqual(current.fulfilled()?.subject, {
    userId: "owner",
    organizationId: null,
  });
});

test("Creem by-id rejects metadata/customer ownership conflicts before money moves", async () => {
  const current = fixture({
    livingUsers: ["owner", "other"],
    customerOwners: { creem_customer_owner: "owner" },
  });

  await assert.rejects(
    () =>
      current.billing.fulfillCreemCheckoutById("checkout_contract", "owner", {
        catalog,
        getCheckout: async () => checkout({ userId: "other", planId: plan.id }),
      }),
    /ownership conflict/,
  );
  assert.equal(current.fulfilled(), null);
});

test("Creem by-id hides a foreign owner and never fulfills it", async () => {
  const current = fixture({
    livingUsers: ["owner"],
    customerOwners: { creem_customer_owner: "owner" },
  });
  const result = await current.billing.fulfillCreemCheckoutById("checkout_contract", "other", {
    catalog,
    getCheckout: async () => checkout({ userId: "owner", planId: plan.id }),
  });

  assert.deepEqual(result, {
    paid: true,
    planId: plan.id,
    userId: null,
  });
  assert.equal(current.fulfilled(), null);
});

test("Creem by-id keeps an unpaid owner result useful while hiding it from another user", async () => {
  const ownerFixture = fixture({
    livingUsers: ["owner"],
    customerOwners: { creem_customer_owner: "owner" },
  });
  const pending = checkout({ userId: "owner", planId: plan.id });
  pending.status = "open";
  const ownerResult = await ownerFixture.billing.fulfillCreemCheckoutById(
    "checkout_contract",
    "owner",
    {
      catalog,
      getCheckout: async () => pending,
    },
  );
  assert.deepEqual(ownerResult, {
    paid: false,
    planId: plan.id,
    userId: "owner",
  });
  assert.equal(ownerFixture.fulfilled(), null);

  const foreignFixture = fixture({
    livingUsers: ["owner"],
    customerOwners: { creem_customer_owner: "owner" },
  });
  const foreignResult = await foreignFixture.billing.fulfillCreemCheckoutById(
    "checkout_contract",
    "other",
    {
      catalog,
      getCheckout: async () => pending,
    },
  );
  assert.deepEqual(foreignResult, {
    paid: false,
    planId: plan.id,
    userId: null,
  });
  assert.equal(foreignFixture.fulfilled(), null);
});

test("Creem by-id rejects an unknown external product without falling back to metadata", async () => {
  const current = fixture({
    livingUsers: ["owner"],
    customerOwners: { creem_customer_owner: "owner" },
  });
  const unknown = checkout({ userId: "owner", planId: plan.id });
  unknown.product = "prod_foreign";
  unknown.order.product = "prod_foreign";

  await assert.rejects(
    () =>
      current.billing.fulfillCreemCheckoutById("checkout_contract", "owner", {
        catalog,
        getCheckout: async () => unknown,
      }),
    /Cannot resolve credit pack plan/,
  );
  assert.equal(current.fulfilled(), null);
});
