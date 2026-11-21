import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import Stripe from "stripe";
import type { AppCommerce } from "@/composition/commerce";
import { createCreemWebhookHandler } from "@/lib/creem/webhook";
import { buildSourceIdentityCatalog } from "@/lib/pricing/source-identity";
import { createStripeWebhookHandler } from "@/lib/stripe/webhook";
import type { PricingPlan } from "@/config/pricing";

interface CapturedFulfillment {
  provider: string;
  providerOrderId: string;
  planId: string;
  credits: number;
}

interface CapturedSubscription {
  providerSubscriptionId: string;
  planId: string;
  providerCustomerId: string | null;
  userId: string | null;
}

interface MemoryRequest {
  method: string;
  path: string;
}

function plan(provider: "stripe" | "creem", externalId: string): PricingPlan {
  return {
    id: `${provider}-webhook-config-pack`,
    provider,
    kind: "credit_pack",
    price: 10,
    currency: "USD",
    credits: 100,
    active: true,
    copy: { en: { name: "Webhook config pack", description: "", features: [] } },
    ...(provider === "stripe"
      ? { stripePriceId: { test: externalId, live: `live-${externalId}` } }
      : { creemProductId: { test: externalId, live: `live-${externalId}` } }),
  };
}

function subscriptionPlan(provider: "stripe", externalId: string): PricingPlan {
  return {
    id: `${provider}-webhook-config-subscription`,
    provider,
    kind: "subscription",
    interval: "month",
    monthlyCredits: 80,
    price: 10,
    currency: "USD",
    active: true,
    copy: { en: { name: "Webhook config subscription", description: "", features: [] } },
    stripePriceId: { test: externalId, live: `live-${externalId}` },
  };
}

function memoryStripe(
  requests: MemoryRequest[],
  respond: (request: MemoryRequest) => unknown,
): Stripe {
  const httpClient: Stripe.HttpClient = {
    getClientName: () => "n3-stripe-memory",
    async makeRequest(...args) {
      const [, , path, method] = args;
      const request = { method, path };
      requests.push(request);
      const payload = respond(request);
      return {
        getStatusCode: () => 200,
        getHeaders: () => ({ "request-id": "req_n3_fixture" }),
        getRawResponse: () => ({}),
        toStream: (complete: () => void) => {
          complete();
          return null;
        },
        toJSON: async () => payload as object,
      };
    },
  };
  return new Stripe("sk_test_memory_fixture_only", {
    httpClient,
    maxNetworkRetries: 0,
    telemetry: false,
  });
}

function fakeApp(
  catalog: ReturnType<typeof buildSourceIdentityCatalog>,
  captured: CapturedFulfillment[],
  capturedSubscriptions: CapturedSubscription[] = [],
) {
  return {
    store: {},
    commerce: {
      runtime: {
        catalog,
        deps: { clock: { now: () => new Date("2026-11-07T00:00:00.000Z") } },
        log() {},
        withUnit: async (_outer: unknown, run: (unit: unknown) => Promise<unknown>) =>
          run({
            identity: {
              findUserIdByProviderCustomer: async () => null,
            },
          }),
      },
      resolveSubject: async ({ userId }: { userId?: string | null }) => ({
        userId: userId ?? null,
        organizationId: null,
      }),
      resolvePlanBySource: (
        {
          provider,
          metadataPlanId,
          externalId,
        }: {
          provider: string;
          metadataPlanId?: string | null;
          externalId?: string | null;
        },
        activeCatalog: ReturnType<typeof buildSourceIdentityCatalog>,
      ) => {
        const fromMetadata = metadataPlanId ? activeCatalog.getPlanById(metadataPlanId) : undefined;
        const fromExternal = externalId
          ? activeCatalog.findPlanByProviderPriceId(
              provider as "stripe" | "creem" | "paypal",
              externalId,
            )
          : undefined;
        return fromExternal && (!fromMetadata || fromMetadata.id === fromExternal.id)
          ? fromExternal
          : null;
      },
      resolveSubscriptionSource: async ({
        provider,
        externalId,
      }: {
        provider: "stripe";
        externalId?: string | null;
      }) => {
        const resolved = externalId
          ? catalog.findPlanByProviderPriceId(provider, externalId)
          : undefined;
        return resolved
          ? {
              plan: resolved,
              subject: null,
              providerPriceId: externalId ?? null,
            }
          : null;
      },
      fulfillOneTimePurchase: async (input: {
        provider: string;
        providerOrderId: string;
        planId: string;
        credits: number;
      }) => {
        captured.push({
          provider: input.provider,
          providerOrderId: input.providerOrderId,
          planId: input.planId,
          credits: input.credits,
        });
        return { created: true };
      },
      fulfillSubscriptionPayment: async (input: {
        subscription: {
          providerSubscriptionId: string;
          planId: string;
          providerCustomerId: string | null;
          subject: { userId: string | null };
        };
      }) => {
        capturedSubscriptions.push({
          providerSubscriptionId: input.subscription.providerSubscriptionId,
          planId: input.subscription.planId,
          providerCustomerId: input.subscription.providerCustomerId,
          userId: input.subscription.subject.userId,
        });
        return { created: true };
      },
    },
  } as unknown as AppCommerce;
}

test("Stripe webhook reuses its verified client and secret and keeps SDK checkout lookup", async () => {
  const captured: CapturedFulfillment[] = [];
  const catalog = buildSourceIdentityCatalog([plan("stripe", "price_config")]);
  const app = fakeApp(catalog, captured);
  const secret = "{{SECRET_awpdr7o3}}";
  const requests: MemoryRequest[] = [];
  const sessionId = `cs_${randomUUID()}`;
  const stripe = memoryStripe(requests, ({ path }) => {
    assert.match(path, new RegExp(`/v1/checkout/sessions/${sessionId}/line_items`));
    return {
      object: "list",
      url: path,
      has_more: false,
      data: [{ object: "item", price: { id: "price_config" }, quantity: 1 }],
    };
  });
  const payload = JSON.stringify({
    id: `evt_${randomUUID()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        mode: "payment",
        payment_status: "paid",
        customer: null,
        payment_intent: `pi_${randomUUID()}`,
        amount_total: 1000,
        currency: "usd",
        metadata: {
          userId: randomUUID(),
          planId: "stripe-webhook-config-pack",
        },
      },
    },
  });
  const handler = createStripeWebhookHandler({
    app,
    client: stripe,
    secret,
    notify: async () => {},
  });
  const response = await handler(
    new Request("https://fixture.invalid/api/stripe/webhook", {
      method: "POST",
      body: payload,
      headers: {
        "stripe-signature": stripe.webhooks.generateTestHeaderString({
          payload,
          secret,
        }),
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(captured, [
    {
      provider: "stripe",
      providerOrderId: sessionId,
      planId: "stripe-webhook-config-pack",
      credits: 100,
    },
  ]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, "GET");
  assert.match(
    requests[0]?.path ?? "",
    new RegExp(`/v1/checkout/sessions/${sessionId}/line_items\\?limit=2$`),
  );
});

test("Stripe invoice keeps SDK subscription, customer and invoice lookup on the selected client", async () => {
  const captured: CapturedFulfillment[] = [];
  const capturedSubscriptions: CapturedSubscription[] = [];
  const subscription = subscriptionPlan("stripe", "price_subscription_config");
  const catalog = buildSourceIdentityCatalog([subscription]);
  const app = fakeApp(catalog, captured, capturedSubscriptions);
  const secret = "{{SECRET_awpdr7o3}}";
  const subscriptionId = `sub_${randomUUID()}`;
  const customerId = `cus_${randomUUID()}`;
  const invoiceId = `in_${randomUUID()}`;
  const userId = randomUUID();
  const requests: MemoryRequest[] = [];
  const stripe = memoryStripe(requests, ({ path }) => {
    if (path.startsWith(`/v1/subscriptions/${subscriptionId}`)) {
      return {
        id: subscriptionId,
        object: "subscription",
        status: "active",
        customer: customerId,
        metadata: {},
        cancel_at_period_end: false,
        canceled_at: null,
        ended_at: null,
        items: {
          object: "list",
          has_more: false,
          data: [
            {
              object: "subscription_item",
              quantity: 1,
              price: { id: "price_subscription_config" },
              current_period_start: 1_700_000_000,
              current_period_end: 1_702_592_000,
            },
          ],
        },
      };
    }
    if (path.startsWith(`/v1/customers/${customerId}`)) {
      return {
        id: customerId,
        object: "customer",
        deleted: false,
        metadata: { userId },
      };
    }
    if (path.startsWith(`/v1/invoices/${invoiceId}`)) {
      return {
        id: invoiceId,
        object: "invoice",
        status: "paid",
        currency: "usd",
        amount_paid: 1000,
        subtotal: 1000,
        billing_reason: "subscription_create",
        parent: { subscription_details: { subscription: subscriptionId } },
        total_discount_amounts: [],
        total_taxes: [],
        payments: {
          object: "list",
          has_more: false,
          data: [
            {
              object: "invoice_payment",
              payment: { object: "payment", payment_intent: `pi_${invoiceId}` },
            },
          ],
        },
      };
    }
    throw new Error(`Unexpected Stripe request: ${path}`);
  });
  const payload = JSON.stringify({
    id: `evt_${randomUUID()}`,
    object: "event",
    type: "invoice.paid",
    data: {
      object: {
        id: invoiceId,
        object: "invoice",
        status: "paid",
        currency: "usd",
        amount_paid: 1000,
        subtotal: 1000,
        billing_reason: "subscription_create",
        parent: { subscription_details: { subscription: subscriptionId } },
      },
    },
  });
  const handler = createStripeWebhookHandler({
    app,
    client: stripe,
    secret,
    notify: async () => {},
  });
  const response = await handler(
    new Request("https://fixture.invalid/api/stripe/webhook", {
      method: "POST",
      body: payload,
      headers: {
        "stripe-signature": stripe.webhooks.generateTestHeaderString({
          payload,
          secret,
        }),
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(capturedSubscriptions, [
    {
      providerSubscriptionId: subscriptionId,
      planId: subscription.id,
      providerCustomerId: customerId,
      userId,
    },
  ]);
  assert.deepEqual(
    requests.map(({ path }) => path.split("?")[0]),
    [
      `/v1/subscriptions/${subscriptionId}`,
      `/v1/customers/${customerId}`,
      `/v1/invoices/${invoiceId}`,
    ],
  );
  assert.match(requests[2]?.path ?? "", /(?:expand%5B0%5D|expand\[0\]|expand\[\])=payments$/);
});

test("Stripe webhook keeps webhook-only clients compatible with injected lookup ports", async () => {
  const captured: CapturedFulfillment[] = [];
  const capturedSubscriptions: CapturedSubscription[] = [];
  const subscription = subscriptionPlan("stripe", "price_subscription_injected");
  const catalog = buildSourceIdentityCatalog([subscription]);
  const app = fakeApp(catalog, captured, capturedSubscriptions);
  const secret = "{{SECRET_awpdr7o3}}";
  const expectedUserId = randomUUID();
  const subscriptionId = `sub_${randomUUID()}`;
  const customerId = `cus_${randomUUID()}`;
  const invoiceId = `in_${randomUUID()}`;
  const lookups: string[] = [];
  let event: Stripe.Event | null = null;
  const client = {
    webhooks: {
      constructEvent(payload: string, signature: string, receivedSecret: string) {
        assert.equal(signature, "fixture-signature");
        assert.equal(receivedSecret, secret);
        event = JSON.parse(payload) as Stripe.Event;
        return event;
      },
    },
  } as unknown as Pick<Stripe, "webhooks">;
  const handler = createStripeWebhookHandler({
    app,
    client,
    secret,
    notify: async () => {},
    adapter: {
      getSubscription: async () => {
        lookups.push("subscription");
        return {
          id: subscriptionId,
          status: "active",
          customer: customerId,
          metadata: {},
          cancel_at_period_end: false,
          canceled_at: null,
          ended_at: null,
          items: {
            data: [
              {
                price: { id: "price_subscription_injected" },
                current_period_start: 1_700_000_000,
                current_period_end: 1_702_592_000,
              },
            ],
            has_more: false,
          },
        } as Stripe.Subscription;
      },
      getCustomer: async () => {
        lookups.push("customer");
        return {
          id: customerId,
          object: "customer",
          deleted: false,
          metadata: { userId: expectedUserId },
        } as unknown as Stripe.Customer;
      },
      getInvoice: async () => {
        lookups.push("invoice");
        return {
          id: invoiceId,
          payments: {
            data: [
              {
                payment: {
                  payment_intent: `pi_${invoiceId}`,
                },
              },
            ],
          },
        } as Stripe.Invoice;
      },
    },
  });
  const payload = JSON.stringify({
    id: `evt_${randomUUID()}`,
    object: "event",
    type: "invoice.paid",
    data: {
      object: {
        id: invoiceId,
        object: "invoice",
        status: "paid",
        currency: "usd",
        amount_paid: 1000,
        subtotal: 1000,
        billing_reason: "subscription_create",
        parent: { subscription_details: { subscription: subscriptionId } },
      },
    },
  });
  const response = await handler(
    new Request("https://fixture.invalid/api/stripe/webhook", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": "fixture-signature" },
    }),
  );

  assert.equal(response.status, 200);
  assert.ok(event);
  assert.deepEqual(lookups, ["subscription", "customer", "invoice"]);
  assert.deepEqual(capturedSubscriptions, [
    {
      providerSubscriptionId: subscriptionId,
      planId: subscription.id,
      providerCustomerId: customerId,
      userId: expectedUserId,
    },
  ]);
});

test("Creem webhook reuses its verified secret in the same fulfillment chain", async () => {
  const captured: CapturedFulfillment[] = [];
  const catalog = buildSourceIdentityCatalog([plan("creem", "prod_config")]);
  const app = fakeApp(catalog, captured);
  const secret = "{{SECRET_5drp5na6}}";
  const userId = randomUUID();
  const orderId = `ord_${randomUUID()}`;
  const now = "2026-11-07T00:00:00.000Z";
  const payload = JSON.stringify({
    id: `evt_${randomUUID()}`,
    eventType: "checkout.completed",
    created_at: Date.now(),
    object: {
      id: `ch_${randomUUID()}`,
      mode: "test",
      object: "checkout",
      status: "completed",
      product: "prod_config",
      units: 1,
      metadata: { userId, planId: "creem-webhook-config-pack" },
      order: {
        id: orderId,
        mode: "test",
        object: "order",
        product: "prod_config",
        transaction: `tran_${randomUUID()}`,
        amount: 1000,
        amount_paid: 1000,
        currency: "USD",
        status: "paid",
        type: "onetime",
        created_at: now,
        updated_at: now,
      },
    },
  });
  const handler = createCreemWebhookHandler({
    app,
    secret,
    notify: async () => {},
  });
  const response = await handler(
    new Request("https://fixture.invalid/api/creem/webhook", {
      method: "POST",
      body: payload,
      headers: {
        "creem-signature": createHmac("sha256", secret).update(payload).digest("hex"),
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(captured, [
    {
      provider: "creem",
      providerOrderId: orderId,
      planId: "creem-webhook-config-pack",
      credits: 100,
    },
  ]);
});
