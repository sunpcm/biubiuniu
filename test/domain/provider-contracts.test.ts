import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import type { PricingPlan, PaymentProvider } from "@/config/pricing";
import { db, closeDatabase } from "@/lib/db";
import {
  orders,
  subscriptions,
  user,
  creditBalances,
  organizationCreditBalances,
  creditTransactions,
} from "@/lib/db/schema";
import { buildSourceIdentityCatalog, resolvePlanBySource } from "@/lib/pricing/source-identity";
import { createStripeWebhookHandler } from "@/lib/stripe/webhook";
import { createCreemWebhookHandler } from "@/lib/creem/webhook";
import { createPayPalWebhookHandler } from "@/lib/paypal/webhook";
import { encodePayPalCustomId } from "@/lib/paypal/metadata";
import { createDomainCommerce } from "./commerce-assembly";
import { migrate, resetSyntheticData } from "./helpers";

function pack(provider: PaymentProvider, id = `${provider}-pack`, credits = 100): PricingPlan {
  return {
    id,
    provider,
    kind: "credit_pack",
    price: 10,
    currency: "USD",
    credits,
    active: false, // retired plans still own their financial history
    copy: { en: { name: id, description: "", features: [] } },
    ...(provider === "stripe"
      ? { stripePriceId: { test: `price-${id}`, live: `live-${id}` } }
      : {}),
    ...(provider === "creem" ? { creemProductId: { test: `prod-${id}`, live: `live-${id}` } } : {}),
  };
}
const plans = [
  pack("stripe"),
  pack("stripe", "stripe-other"),
  pack("creem"),
  pack("creem", "creem-other"),
  pack("paypal"),
  pack("paypal", "paypal-other"),
];
const catalog = buildSourceIdentityCatalog(plans);
const domain = createDomainCommerce({
  catalog,
  purchasesEnabled: true,
  notifier: {
    onOrderCommitted: async () => {},
    onDuplicateSubscription: async () => {},
    onPaymentDenied: async () => {},
    onDispute: async () => {},
  },
});
const { recordPayPalSourceBinding } = domain.paypalSource;
const { fulfillPayPalCapture, recordPendingPayPalCapture } = domain.paypal;
const { recordPendingOneTimePurchase } = domain.fulfillment;
const { getUserCredits } = domain.credits;
const stripe = new Stripe("sk_test_local_fixture_only");
const secret = "local-fixture-webhook-secret";
const silentNotify = async () => {};

function stripeWithMemoryLineItems(
  requests: string[],
  resolve: (sessionId: string) => unknown,
): Stripe {
  const httpClient: Stripe.HttpClient = {
    getClientName: () => "n3-stripe-pg-memory",
    async makeRequest(...args) {
      const [, , path, method] = args;
      requests.push(`${method} ${path}`);
      const match = path.match(/^\/v1\/checkout\/sessions\/([^/?]+)\/line_items\?limit=2$/);
      if (!match) throw new Error(`Unexpected Stripe request: ${method} ${path}`);
      return {
        getStatusCode: () => 200,
        getHeaders: () => ({ "request-id": "req_n3_pg_fixture" }),
        getRawResponse: () => ({}),
        toStream: (complete: () => void) => {
          complete();
          return null;
        },
        toJSON: async () => resolve(match[1]!) as object,
      };
    },
  };
  return new Stripe("sk_test_memory_fixture_only", {
    httpClient,
    maxNetworkRetries: 0,
    telemetry: false,
  });
}

async function actor() {
  const [row] = await db
    .insert(user)
    .values({ email: `${randomUUID()}@example.invalid` })
    .returning();
  return row.id;
}
async function snapshot() {
  // Exact business state, not just row counts. No helper that performs lazy grants.
  return JSON.stringify(
    await Promise.all([
      db.select().from(orders).orderBy(orders.id),
      db.select().from(subscriptions).orderBy(subscriptions.id),
      db.select().from(creditBalances).orderBy(creditBalances.userId),
      db
        .select()
        .from(organizationCreditBalances)
        .orderBy(organizationCreditBalances.organizationId),
      db.select().from(creditTransactions).orderBy(creditTransactions.id),
      db.select().from(user).orderBy(user.id),
    ]),
  );
}
function stripePayload(
  userId: string,
  price = "price-stripe-pack",
  metadataPlan = "stripe-pack",
  id = `cs_${randomUUID()}`,
) {
  return {
    id: `evt_${randomUUID()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id,
        object: "checkout.session",
        mode: "payment",
        payment_status: "paid",
        customer: null,
        payment_intent: `pi_${id}`,
        amount_total: 1000,
        currency: "usd",
        metadata: { userId, planId: metadataPlan },
        line_items: { data: [{ price: { id: price }, quantity: 1 }], has_more: false },
      },
    },
  };
}
function stripeRequest(payload: unknown, valid = true) {
  const body = JSON.stringify(payload);
  return new Request("https://fixture.invalid/api/stripe/webhook", {
    method: "POST",
    body,
    headers: {
      "stripe-signature": valid
        ? stripe.webhooks.generateTestHeaderString({ payload: body, secret })
        : "t=0,v1=bad",
    },
  });
}
function creemPayload(userId: string, product = "prod-creem-pack", metadataPlan = "creem-pack") {
  const now = new Date().toISOString();
  return {
    id: `evt_${randomUUID()}`,
    eventType: "checkout.completed",
    created_at: Date.now(),
    object: {
      id: `ch_${randomUUID()}`,
      mode: "test",
      object: "checkout",
      status: "completed",
      product,
      units: 1,
      metadata: { userId, planId: metadataPlan },
      order: {
        id: `ord_${randomUUID()}`,
        mode: "test",
        object: "order",
        product,
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
  };
}
function creemRequest(payload: unknown, valid = true) {
  const body = JSON.stringify(payload);
  return new Request("https://fixture.invalid/api/creem/webhook", {
    method: "POST",
    body,
    headers: {
      "creem-signature": valid ? createHmac("sha256", secret).update(body).digest("hex") : "bad",
    },
  });
}
function paypalRequest(payload: unknown, signature = "valid-fixture-signature") {
  return new Request("https://fixture.invalid/api/paypal/webhook", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://api.paypal.com/cert/fixture",
      "paypal-transmission-id": "transmission-fixture",
      "paypal-transmission-sig": signature,
      "paypal-transmission-time": new Date().toISOString(),
    },
  });
}
function paypalPayload(userId: string, orderId: string, captureId = `cap_${randomUUID()}`) {
  return {
    id: `evt_${randomUUID()}`,
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: captureId,
      status: "COMPLETED",
      custom_id: encodePayPalCustomId({ userId, planId: "paypal-pack" }),
      amount: { value: "10.00", currency_code: "USD" },
      supplementary_data: { related_ids: { order_id: orderId } },
    },
  };
}
async function binding(userId: string, orderId = `pp_${randomUUID()}`) {
  await recordPayPalSourceBinding({
    orderId,
    userId,
    organizationId: null,
    planId: "paypal-pack",
    amountTotal: 1000,
    currency: "usd",
  });
  return orderId;
}

before(async () => {
  await migrate();
});
after(async () => {
  await closeDatabase();
});

test("catalog snapshots and same-name provider instances never mutate each other", () => {
  const input = [pack("stripe")];
  const a = buildSourceIdentityCatalog(input);
  input[0] = pack("stripe", "stripe-pack", 777);
  const b = buildSourceIdentityCatalog(input);
  assert.equal((a.getPlanById("stripe-pack") as { credits: number }).credits, 100);
  assert.equal((b.getPlanById("stripe-pack") as { credits: number }).credits, 777);
  assert.throws(() => {
    (a.getPlanById("stripe-pack") as { credits: number }).credits = 1;
  });
  for (const provider of ["stripe", "creem", "paypal"] as const) {
    assert.equal(
      resolvePlanBySource({ provider, metadataPlanId: `${provider}-pack` }, catalog),
      null,
    );
    assert.equal(
      resolvePlanBySource(
        { provider, metadataPlanId: `${provider}-pack`, externalId: "unknown" },
        catalog,
      ),
      null,
    );
  }
  assert.equal(
    resolvePlanBySource(
      { provider: "stripe", metadataPlanId: "unknown", externalId: "price-stripe-pack" },
      catalog,
    ),
    null,
  );
  assert.equal(
    resolvePlanBySource(
      { provider: "stripe", metadataPlanId: "creem-pack", externalId: "price-stripe-pack" },
      catalog,
    ),
    null,
  );
});

test("Stripe route HMAC -> actual adapter -> PG: once; bad signature/source/channel/subject zero writes", async () => {
  await resetSyntheticData();
  const userId = await actor();
  const other = await actor();
  const handler = createStripeWebhookHandler({
    app: domain.app,
    client: stripe,
    secret,
    notify: silentNotify,
  });
  for (const payload of [
    stripePayload(userId),
    stripePayload(userId, "foreign"),
    stripePayload(userId, "price-stripe-other"),
    stripePayload(userId, "price-stripe-pack", "creem-pack"),
  ]) {
    const prior = await snapshot();
    assert.equal((await handler(stripeRequest(payload, false))).status, 400);
    assert.equal(await snapshot(), prior);
  }
  for (const [price, plan] of [
    ["foreign", "stripe-pack"],
    ["price-stripe-other", "stripe-pack"],
    ["price-stripe-pack", "creem-pack"],
    ["price-stripe-pack", "unknown"],
  ]) {
    const prior = await snapshot();
    assert.equal((await handler(stripeRequest(stripePayload(userId, price, plan)))).status, 500);
    assert.equal(await snapshot(), prior);
  }
  const good = stripePayload(userId);
  const responses = await Promise.all(
    Array.from({ length: 4 }, () => handler(stripeRequest(good))),
  );
  assert.ok(responses.every((res) => res.status === 200));
  assert.equal((await getUserCredits(userId)).purchasedCredits, 100);
  assert.equal((await db.select().from(orders)).length, 1);
  assert.equal((await db.select().from(creditTransactions)).length, 1);
  const forged = structuredClone(good);
  forged.data.object.metadata.userId = other;
  const prior = await snapshot();
  // Permanent conflict may be acknowledged, but it never changes the account.
  await handler(stripeRequest(forged));
  assert.equal(await snapshot(), prior);
  assert.equal((await getUserCredits(other)).totalCredits, 0);
});

test("Stripe actual checkout lookup fails closed on missing, failed, multiple or foreign prices", async () => {
  await resetSyntheticData();
  const userId = await actor();
  let lookups = 0;
  const payload = stripePayload(userId);
  const unexpanded = {
    ...payload,
    data: { object: { ...payload.data.object, line_items: undefined } },
  };
  for (const data of [
    [],
    [{ price: null, quantity: 1 }],
    [{ price: { id: "foreign" }, quantity: 1 }],
    [{ price: { id: "price-stripe-pack" }, quantity: 2 }],
    [
      { price: { id: "price-stripe-pack" }, quantity: 1 },
      { price: { id: "foreign" }, quantity: 1 },
    ],
  ]) {
    const handler = createStripeWebhookHandler({
      app: domain.app,
      client: stripe,
      secret,
      notify: silentNotify,
      adapter: {
        lineItems: {
          async listLineItems() {
            lookups++;
            return { data };
          },
        },
      },
    });
    const prior = await snapshot();
    assert.equal((await handler(stripeRequest(unexpanded))).status, 500);
    assert.equal(await snapshot(), prior);
  }
  const broken = createStripeWebhookHandler({
    app: domain.app,
    client: stripe,
    secret,
    notify: silentNotify,
    adapter: {
      lineItems: {
        async listLineItems() {
          throw new Error("fixture transport unavailable");
        },
      },
    },
  });
  const prior = await snapshot();
  assert.equal((await broken(stripeRequest(unexpanded))).status, 500);
  assert.equal(await snapshot(), prior);
  const valid = createStripeWebhookHandler({
    app: domain.app,
    client: stripe,
    secret,
    notify: silentNotify,
    adapter: {
      lineItems: {
        async listLineItems() {
          lookups++;
          return { data: [{ price: { id: "price-stripe-pack" }, quantity: 1 }] };
        },
      },
    },
  });
  assert.equal((await valid(stripeRequest(unexpanded))).status, 200);
  assert.equal(lookups, 6);
  assert.equal((await getUserCredits(userId)).purchasedCredits, 100);
});

test("Stripe SDK lookup through the actual adapter fulfills once in PG", async () => {
  await resetSyntheticData();
  const userId = await actor();
  const payload = stripePayload(userId);
  const sessionId = payload.data.object.id;
  const unexpanded = {
    ...payload,
    data: {
      object: {
        ...payload.data.object,
        line_items: undefined,
      },
    },
  };
  const requests: string[] = [];
  const client = stripeWithMemoryLineItems(requests, (requestedSessionId) => {
    assert.equal(requestedSessionId, sessionId);
    return {
      object: "list",
      url: `/v1/checkout/sessions/${sessionId}/line_items`,
      has_more: false,
      data: [{ object: "item", price: { id: "price-stripe-pack" }, quantity: 1 }],
    };
  });
  const handler = createStripeWebhookHandler({
    app: domain.app,
    client,
    secret,
    notify: silentNotify,
  });
  const good = stripeRequest(unexpanded);

  const responses = await Promise.all(Array.from({ length: 3 }, () => handler(good.clone())));
  assert.ok(responses.every((response) => response.status === 200));
  assert.deepEqual(requests, [
    `GET /v1/checkout/sessions/${sessionId}/line_items?limit=2`,
    `GET /v1/checkout/sessions/${sessionId}/line_items?limit=2`,
    `GET /v1/checkout/sessions/${sessionId}/line_items?limit=2`,
  ]);
  assert.equal((await getUserCredits(userId)).purchasedCredits, 100);
  assert.equal((await db.select().from(orders)).length, 1);
  assert.equal((await db.select().from(creditTransactions)).length, 1);
});

test("Creem route real SDK HMAC + strict parse -> actual adapter -> PG with retired catalog", async () => {
  await resetSyntheticData();
  const userId = await actor();
  const handler = createCreemWebhookHandler({
    app: domain.app,
    secret,
    notify: silentNotify,
  });
  const good = creemPayload(userId);
  let prior = await snapshot();
  assert.equal((await handler(creemRequest(good, false))).status, 400);
  assert.equal(await snapshot(), prior);
  for (const [product, plan] of [
    ["foreign", "creem-pack"],
    ["prod-creem-other", "creem-pack"],
    ["prod-creem-pack", "stripe-pack"],
    ["", "creem-pack"],
  ]) {
    prior = await snapshot();
    assert.equal((await handler(creemRequest(creemPayload(userId, product, plan)))).status, 500);
    assert.equal(await snapshot(), prior);
  }
  assert.equal((await handler(creemRequest(good))).status, 200);
  assert.equal((await handler(creemRequest(good))).status, 200);
  assert.equal((await getUserCredits(userId)).purchasedCredits, 100);
  assert.equal((await db.select().from(orders)).length, 1);
  assert.equal((await db.select().from(creditTransactions)).length, 1);
  const contradictory = creemPayload(userId);
  contradictory.object.order.product = "foreign";
  prior = await snapshot();
  await handler(creemRequest(contradictory));
  assert.equal(await snapshot(), prior);
});

test("PayPal official verification adapter transport -> actual bound capture -> PG, strict failure branches", async () => {
  await resetSyntheticData();
  const userId = await actor();
  const other = await actor();
  const orderId = await binding(userId);
  const good = paypalPayload(userId, orderId);
  const verifyBodies: string[] = [];
  const handler = createPayPalWebhookHandler({
    app: domain.app,
    webhookId: "WH-local-fixture",
    notify: silentNotify,
    transport: {
      async verifySignature(body) {
        verifyBodies.push(body);
        const sent = JSON.parse(body);
        assert.equal(sent.webhook_id, "WH-local-fixture");
        assert.equal(sent.transmission_id, "transmission-fixture");
        assert.equal(sent.cert_url, "https://api.paypal.com/cert/fixture");
        assert.equal(sent.auth_algo, "SHA256withRSA");
        return {
          status: 200,
          verificationStatus:
            sent.transmission_sig === "valid-fixture-signature" ? "SUCCESS" : "FAILURE",
        };
      },
    },
  });
  let prior = await snapshot();
  assert.equal((await handler(paypalRequest(good, "bad"))).status, 400);
  assert.equal(await snapshot(), prior);
  const noHeaders = new Request("https://fixture.invalid/api/paypal/webhook", {
    method: "POST",
    body: JSON.stringify(good),
  });
  assert.equal((await handler(noHeaders)).status, 400);
  assert.equal(await snapshot(), prior);
  for (const result of [
    { status: 400, verificationStatus: "SUCCESS" },
    { status: 302, verificationStatus: "SUCCESS" },
    { status: 200, verificationStatus: "FAILURE" },
  ]) {
    let calls = 0;
    const denied = createPayPalWebhookHandler({
      app: domain.app,
      webhookId: "WH-local-fixture",
      notify: silentNotify,
      transport: {
        async verifySignature() {
          calls++;
          return result;
        },
      },
    });
    assert.equal((await denied(paypalRequest(good))).status, 400);
    assert.equal(calls, 1);
    assert.equal(await snapshot(), prior);
  }
  for (const change of [
    (e: ReturnType<typeof paypalPayload>) => {
      e.resource.custom_id = encodePayPalCustomId({ userId: other, planId: "paypal-pack" });
    },
    (e: ReturnType<typeof paypalPayload>) => {
      e.resource.custom_id = encodePayPalCustomId({ userId, planId: "paypal-other" });
    },
    (e: ReturnType<typeof paypalPayload>) => {
      e.resource.custom_id = encodePayPalCustomId({ userId, planId: "stripe-pack" });
    },
    (e: ReturnType<typeof paypalPayload>) => {
      e.resource.custom_id = encodePayPalCustomId({
        userId,
        planId: "paypal-pack",
        organizationId: randomUUID(),
      });
    },
    (e: ReturnType<typeof paypalPayload>) => {
      e.resource.amount.value = "9.00";
    },
    (e: ReturnType<typeof paypalPayload>) => {
      e.resource.amount.currency_code = "EUR";
    },
    (e: ReturnType<typeof paypalPayload>) => {
      e.resource.supplementary_data.related_ids.order_id = "unknown";
    },
  ]) {
    const bad = structuredClone(good);
    change(bad);
    prior = await snapshot();
    assert.equal((await handler(paypalRequest(bad))).status, 500);
    assert.equal(await snapshot(), prior);
  }
  const unknown = paypalPayload(userId, "never-created");
  prior = await snapshot();
  assert.equal((await handler(paypalRequest(unknown))).status, 500);
  assert.equal(await snapshot(), prior);
  const responses = await Promise.all(
    Array.from({ length: 4 }, () => handler(paypalRequest(good))),
  );
  assert.ok(responses.every((r) => r.status === 200));
  assert.equal((await getUserCredits(userId)).purchasedCredits, 100);
  const rows = await db.select().from(orders);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].providerOrderId, orderId);
  assert.equal(rows[0].providerPaymentId, good.resource.id);
  assert.equal(rows[0].amountTotal, 1000);
  assert.equal(rows[0].userId, userId);
  assert.equal(rows[0].status, "completed");
  assert.equal((await db.select().from(creditTransactions)).length, 1);
  assert.ok(
    verifyBodies.some((body) => JSON.parse(body).webhook_event.resource.id === good.resource.id),
  );
});

test("PayPal pending binding conflicts are explicit and legacy capture IDs remain replay-safe", async () => {
  await resetSyntheticData();
  const userId = await actor();
  const other = await actor();
  const orderId = await binding(userId);
  const prior = await snapshot();
  await assert.rejects(
    () =>
      recordPayPalSourceBinding({
        orderId,
        userId: other,
        organizationId: null,
        planId: "paypal-pack",
        amountTotal: 1000,
        currency: "usd",
      }),
    /conflict/,
  );
  assert.equal(await snapshot(), prior);
  const captureId = `capture_${randomUUID()}`;
  const input = {
    captureId,
    sourceOrderId: orderId,
    customId: encodePayPalCustomId({ userId, planId: "paypal-pack" }),
    amountValue: "10.00",
    currencyCode: "USD",
  };
  await recordPendingPayPalCapture(input);
  assert.equal((await db.select().from(orders)).length, 1);
  assert.equal((await getUserCredits(userId)).totalCredits, 0);
  await Promise.all([fulfillPayPalCapture(input), fulfillPayPalCapture(input)]);
  assert.equal((await getUserCredits(userId)).purchasedCredits, 100);
  const settled = await snapshot();
  await assert.rejects(
    () => fulfillPayPalCapture({ ...input, captureId: "different-capture" }),
    /conflict/,
  );
  assert.equal(await snapshot(), settled);
  // Historical pending orders used capture ID as their business key. The
  // verified local row, not metadata alone, proves missing external identity.
  const legacyId = `legacy_${randomUUID()}`;
  await recordPendingOneTimePurchase({
    provider: "paypal",
    providerOrderId: legacyId,
    providerPaymentId: legacyId,
    subject: { userId, organizationId: null },
    planId: "paypal-pack",
    credits: 0,
    amountTotal: 1000,
    currency: "usd",
    metadata: { paypalOrderId: "legacy-remote-order" },
  });
  const legacy = { ...input, captureId: legacyId, sourceOrderId: "legacy-remote-order" };
  assert.equal((await fulfillPayPalCapture(legacy)).created, true);
  assert.equal((await fulfillPayPalCapture(legacy)).created, false);
  assert.equal((await getUserCredits(userId)).purchasedCredits, 200);
  assert.equal(
    (
      await db
        .select()
        .from(orders)
        .where(and(eq(orders.provider, "paypal"), eq(orders.providerOrderId, legacyId)))
    ).length,
    1,
  );
});

test("same-name explicit catalogs stay independent through real Stripe adapters and PG", async () => {
  await resetSyntheticData();
  const a = await actor();
  const b = await actor();
  const ca = buildSourceIdentityCatalog([pack("stripe", "shared-name", 100)]);
  const cb = buildSourceIdentityCatalog([pack("stripe", "shared-name", 300)]);
  const domainA = createDomainCommerce({
    catalog: ca,
    purchasesEnabled: true,
    notifier: {
      onOrderCommitted: async () => {},
      onDuplicateSubscription: async () => {},
      onPaymentDenied: async () => {},
      onDispute: async () => {},
    },
  });
  const domainB = createDomainCommerce({
    catalog: cb,
    purchasesEnabled: true,
    notifier: {
      onOrderCommitted: async () => {},
      onDuplicateSubscription: async () => {},
      onPaymentDenied: async () => {},
      onDispute: async () => {},
    },
  });
  const ha = createStripeWebhookHandler({
    app: domainA.app,
    client: stripe,
    secret,
    notify: silentNotify,
  });
  const hb = createStripeWebhookHandler({
    app: domainB.app,
    client: stripe,
    secret,
    notify: silentNotify,
  });
  await Promise.all([
    ha(stripeRequest(stripePayload(a, "price-shared-name", "shared-name"))),
    hb(stripeRequest(stripePayload(b, "price-shared-name", "shared-name"))),
  ]);
  assert.equal((await domainA.credits.getUserCredits(a)).purchasedCredits, 100);
  assert.equal((await domainB.credits.getUserCredits(b)).purchasedCredits, 300);
});
