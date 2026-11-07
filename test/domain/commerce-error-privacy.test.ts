import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import Stripe from "stripe";
import type { PricingPlan } from "@/config/pricing";
import { closeDatabase, db } from "@/lib/db";
import {
  creditBalances,
  creditTransactions,
  orders,
  organizationCreditBalances,
  user as userTable,
} from "@/lib/db/schema";
import { notifyCreditGrantFailed } from "@/lib/billing/notify";
import { createDomainCommerce, type DomainCommerce } from "./commerce-assembly";
import { createCreemWebhookHandler } from "@/lib/creem/webhook";
import { createLogger, type AppLogger } from "@/lib/logger";
import { createPayPalCaptureHandler } from "@/lib/paypal/capture";
import { createPayPalCreateOrderHandler } from "@/lib/paypal/create-order";
import { encodePayPalCustomId } from "@/lib/paypal/metadata";
import { createPayPalWebhookHandler } from "@/lib/paypal/webhook";
import { verifyPayPalWebhookSignature } from "@/lib/paypal/webhook-verify";
import { createStripeWebhookHandler } from "@/lib/stripe/webhook";
import { migrate, resetSyntheticData } from "./helpers";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const pino = appRequire("pino") as (
  options: { level: string },
  destination: { write(chunk: string): void },
) => { flush?: () => void };
const DATABASE_ENABLED = Boolean(process.env.DATABASE_URL);
const pgTest = DATABASE_ENABLED ? test : test.skip;
const MARKER = "SYNTHETIC_PRIVACY_MARKER_0808";

interface CapturedLogger {
  logger: AppLogger;
  text: () => string;
  flush: () => void;
}

function createCapturedLogger(name: string): CapturedLogger {
  const pinoLines: string[] = [];
  const breadcrumbs: unknown[] = [];
  const exceptions: Array<{ error: Error; context: unknown }> = [];
  const messages: Array<{ message: string; context: unknown }> = [];
  const pinoLogger = pino(
    { level: "debug" },
    {
      write(chunk: string) {
        pinoLines.push(chunk);
      },
    },
  );
  const logger = createLogger(name, {
    pino: pinoLogger,
    sentry: {
      addBreadcrumb(breadcrumb) {
        breadcrumbs.push(breadcrumb);
      },
      captureException(error, context) {
        exceptions.push({ error, context });
        return undefined;
      },
      captureMessage(message, context) {
        messages.push({ message, context });
        return undefined;
      },
    },
  });
  return {
    logger,
    flush: () => pinoLogger.flush(),
    text: () =>
      JSON.stringify(
        {
          pino: pinoLines,
          breadcrumbs,
          exceptions,
          messages,
        },
        (_key, value) =>
          value instanceof Error
            ? {
                name: value.name,
                message: value.message,
                stack: value.stack,
                ...value,
              }
            : value,
      ),
  };
}

function sensitiveSdkError(): Error {
  const error = new Error(
    `gateway rejected Bearer ${MARKER}; postgresql://svc:${MARKER}@db.invalid/app; authorization=${MARKER}`,
  );
  error.stack = `${error.stack ?? ""}\nCookie: sid=${MARKER}\nAuthorization: Bearer ${MARKER}`;
  Object.assign(error, {
    config: {
      headers: {
        Authorization: `Bearer ${MARKER}`,
        Cookie: `sid=${MARKER}`,
      },
    },
  });
  return error;
}

function assertSafe(label: string, value: string): void {
  assert.equal(value.includes(MARKER), false, `${label} leaked the synthetic marker`);
}

async function withConsoleCapture<T>(
  operation: () => Promise<T>,
): Promise<{ value: T; calls: unknown[][] }> {
  const previousError = console.error;
  const previousWarn = console.warn;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => calls.push(args);
  console.warn = (...args: unknown[]) => calls.push(args);
  try {
    return { value: await operation(), calls };
  } finally {
    console.error = previousError;
    console.warn = previousWarn;
  }
}

function financialSnapshot(): Promise<string> {
  return Promise.all([
    db.select().from(orders).orderBy(orders.id),
    db.select().from(organizationCreditBalances).orderBy(organizationCreditBalances.organizationId),
    db.select().from(creditTransactions).orderBy(creditTransactions.id),
    db.select().from(creditBalances).orderBy(creditBalances.userId),
  ]).then((rows) => JSON.stringify(rows));
}

async function createUser(): Promise<string> {
  const [row] = await db
    .insert(userTable)
    .values({ email: `${randomUUID()}@example.invalid` })
    .returning({ id: userTable.id });
  return row.id;
}

function notificationFixture(logger: AppLogger) {
  const messages: Array<{
    reactProps?: Record<string, unknown>;
  }> = [];
  const notify = async (params: Parameters<typeof notifyCreditGrantFailed>[0]): Promise<void> => {
    await notifyCreditGrantFailed(params, {
      logger,
      loadAlertRedis: async () => null,
      deliverEmail: async (message) => {
        messages.push(message as { reactProps?: Record<string, unknown> });
      },
    });
  };
  return { notify, messages };
}

function subscriptionPlan(provider: "stripe" | "creem" | "paypal"): PricingPlan {
  return {
    id: `${provider}-privacy-plan`,
    provider,
    kind: "subscription",
    interval: "month",
    price: 10,
    currency: "USD",
    monthlyCredits: 100,
    active: true,
    copy: {
      en: {
        name: `${provider} privacy plan`,
        description: "",
        features: [],
      },
    },
  };
}

function creemSubscriptionPaidPayload() {
  const now = new Date().toISOString();
  return {
    id: `evt_${randomUUID()}`,
    eventType: "subscription.paid",
    created_at: Date.now(),
    object: {
      id: `sub_${randomUUID()}`,
      mode: "test",
      object: "subscription",
      product: {
        id: "prod-creem-privacy",
        mode: "test",
        object: "product",
        name: "Privacy fixture",
        description: "",
        price: 1000,
        currency: "USD",
        billing_type: "recurring",
        billing_period: "every-month",
        status: "active",
        tax_mode: "inclusive",
        tax_category: "saas",
        created_at: now,
        updated_at: now,
      },
      customer: {
        id: `cus_${randomUUID()}`,
        mode: "test",
        object: "customer",
        email: "privacy@example.invalid",
        country: null,
        created_at: now,
        updated_at: now,
      },
      collection_method: "charge_automatically",
      status: "active",
      metadata: {},
      created_at: now,
      updated_at: now,
    },
  };
}

let originalAdminEmail: string | undefined;
let domain: DomainCommerce;

before(async () => {
  originalAdminEmail = process.env.DEFAULT_ADMIN_EMAIL;
  process.env.DEFAULT_ADMIN_EMAIL = "privacy-admin@example.invalid";
  domain = createDomainCommerce({ purchasesEnabled: true });
  if (!DATABASE_ENABLED) return;
  await migrate();
});

after(async () => {
  if (originalAdminEmail === undefined) delete process.env.DEFAULT_ADMIN_EMAIL;
  else process.env.DEFAULT_ADMIN_EMAIL = originalAdminEmail;
  if (DATABASE_ENABLED) await closeDatabase();
});

test("credit-grant alert email uses the shared sanitizer for message and stack", async () => {
  const captured = createCapturedLogger("billing.notify.privacy-test");
  const fixture = notificationFixture(captured.logger);
  const error = sensitiveSdkError();

  await fixture.notify({
    userId: "user-privacy",
    orderId: "order-privacy",
    planId: "plan-privacy",
    error,
  });
  captured.flush();

  assert.equal(fixture.messages.length, 1);
  const props = fixture.messages[0]?.reactProps;
  assert.ok(props);
  assert.match(String(props.errorMessage), /gateway rejected Bearer \[Redacted\]/);
  assert.match(String(props.errorMessage), /postgresql:\/\/\[Redacted\]@db\.invalid\/app/);
  assert.match(String(props.errorMessage), /authorization=\[Redacted\]/);
  assert.match(String(props.errorStack), /Cookie: \[Redacted\]/);
  assertSafe("alert email", JSON.stringify(props));
  assertSafe("alert logger", captured.text());
});

test("PayPal verification keeps 4xx-no-retry and retry-safety behavior", async () => {
  const fourHundred = createCapturedLogger("billing.paypal.verify.4xx");
  let calls = 0;
  const fourHundredResult = await verifyPayPalWebhookSignature(
    {
      authAlgo: "SHA256withRSA",
      certUrl: "https://fixture.invalid/cert",
      transmissionId: "transmission",
      transmissionSig: "signature",
      transmissionTime: new Date().toISOString(),
    },
    "{}",
    {
      async verifySignature() {
        calls += 1;
        return { status: 400 };
      },
    },
    "WH-fixture",
    fourHundred.logger,
  );
  fourHundred.flush();
  assert.equal(fourHundredResult, false);
  assert.equal(calls, 1);

  const retry = createCapturedLogger("billing.paypal.verify.retry");
  calls = 0;
  const retryResult = await verifyPayPalWebhookSignature(
    {
      authAlgo: "SHA256withRSA",
      certUrl: "https://fixture.invalid/cert",
      transmissionId: "transmission",
      transmissionSig: "signature",
      transmissionTime: new Date().toISOString(),
    },
    "{}",
    {
      async verifySignature() {
        calls += 1;
        if (calls === 1) throw sensitiveSdkError();
        return { status: 400 };
      },
    },
    "WH-fixture",
    retry.logger,
  );
  retry.flush();
  assert.equal(retryResult, false);
  assert.equal(calls, 2);
  assertSafe("PayPal verification logger", retry.text());
});

test("PayPal create-order factory returns a stable body and sanitized diagnostics", async () => {
  const captured = createCapturedLogger("billing.paypal.create-order.test");
  const plan: PricingPlan = {
    id: "paypal-privacy-pack",
    provider: "paypal",
    kind: "credit_pack",
    credits: 100,
    price: 10,
    currency: "USD",
    active: true,
    copy: {
      en: {
        name: "Privacy pack",
        description: "",
        features: [],
      },
    },
  };
  const handler = createPayPalCreateOrderHandler({
    isPurchaseEnabled: () => true,
    getFreshSession: async () => ({ user: { id: "privacy-user" } }),
    getWorkspace: async () => ({ organizationId: null }),
    getPlan: () => plan,
    getPlanCopy: () => ({ name: "Privacy pack" }),
    paypalEnabled: true,
    createOrder: async () => {
      throw sensitiveSdkError();
    },
    recordSourceBinding: async () => {},
    logger: captured.logger,
  } as unknown as Parameters<typeof createPayPalCreateOrderHandler>[0]);
  const request = new Request("https://fixture.invalid/api/paypal/create-order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ planId: plan.id }),
  });

  const { value: response, calls } = await withConsoleCapture(() => handler(request));
  captured.flush();
  const body = await response.text();
  assert.equal(response.status, 500);
  assert.equal(body.includes("Failed to create PayPal order."), true);
  assertSafe("PayPal create HTTP body", body);
  assertSafe("PayPal create logger", captured.text());
  assert.equal(calls.length, 0);
});

pgTest(
  "Stripe real HMAC factory and adapter sanitize SDK headers, text, HTTP, logs, Sentry and email",
  async () => {
    await resetSyntheticData();
    const userId = await createUser();
    const secret = "whsec_privacy_fixture";
    const stripe = new Stripe("sk_test_privacy_fixture");
    const captured = createCapturedLogger("billing.stripe.privacy-test");
    const notification = notificationFixture(captured.logger);
    const handler = createStripeWebhookHandler({
      app: domain.app,
      client: stripe,
      secret,
      logger: captured.logger,
      notify: notification.notify,
      adapter: {
        catalog: {
          getPlanById: () => subscriptionPlan("stripe"),
          findPlanByProviderPriceId: () => subscriptionPlan("stripe"),
        },
        lineItems: {
          async listLineItems() {
            throw sensitiveSdkError();
          },
        },
      },
    });
    const payload = JSON.stringify({
      id: `evt_${randomUUID()}`,
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_${randomUUID()}`,
          object: "checkout.session",
          mode: "payment",
          payment_status: "paid",
          customer: null,
          payment_intent: `pi_${randomUUID()}`,
          amount_total: 1000,
          currency: "usd",
          metadata: {
            userId,
            planId: "stripe-privacy-plan",
          },
        },
      },
    });
    const request = new Request("https://fixture.invalid/api/stripe/webhook", {
      method: "POST",
      body: payload,
      headers: {
        "stripe-signature": stripe.webhooks.generateTestHeaderString({
          payload,
          secret,
        }),
      },
    });
    const beforeState = await financialSnapshot();
    const { value: response, calls } = await withConsoleCapture(() => handler(request));
    const body = await response.text();
    captured.flush();

    assert.equal(response.status, 500);
    assert.equal(body.includes("Failed to process Stripe webhook."), true);
    assert.equal(await financialSnapshot(), beforeState);
    assertSafe("Stripe HTTP body", body);
    assertSafe("Stripe logger and Sentry", captured.text());
    assert.equal(notification.messages.length, 1);
    assertSafe("Stripe alert email", JSON.stringify(notification.messages[0]?.reactProps));
    assert.equal(calls.length, 0);
  },
);

pgTest("Creem real HMAC factory and adapter sanitize an SDK transport failure", async () => {
  await resetSyntheticData();
  const secret = "creem_privacy_fixture";
  const captured = createCapturedLogger("billing.creem.privacy-test");
  const notification = notificationFixture(captured.logger);
  const handler = createCreemWebhookHandler({
    app: domain.app,
    secret,
    logger: captured.logger,
    notify: notification.notify,
    adapter: {
      getSubscription: async () => {
        throw sensitiveSdkError();
      },
    },
  });
  const payload = creemSubscriptionPaidPayload();
  const body = JSON.stringify(payload);
  const request = new Request("https://fixture.invalid/api/creem/webhook", {
    method: "POST",
    body,
    headers: {
      "creem-signature": createHmac("sha256", secret).update(body).digest("hex"),
    },
  });
  const beforeState = await financialSnapshot();
  const { value: response, calls } = await withConsoleCapture(() => handler(request));
  const responseBody = await response.text();
  captured.flush();

  assert.equal(response.status, 500);
  assert.equal(responseBody.includes("Failed to process Creem webhook."), true);
  assert.equal(await financialSnapshot(), beforeState);
  assertSafe("Creem HTTP body", responseBody);
  assertSafe("Creem logger and Sentry", captured.text());
  assert.equal(notification.messages.length, 1);
  assertSafe("Creem alert email", JSON.stringify(notification.messages[0]?.reactProps));
  assert.equal(calls.length, 0);
});

pgTest(
  "PayPal webhook real factory and adapter sanitize a subscription transport failure",
  async () => {
    await resetSyntheticData();
    const captured = createCapturedLogger("billing.paypal.webhook.privacy-test");
    const notification = notificationFixture(captured.logger);
    const userId = await createUser();
    const handler = createPayPalWebhookHandler({
      app: domain.app,
      webhookId: "WH-privacy-fixture",
      logger: captured.logger,
      notify: notification.notify,
      transport: {
        async verifySignature() {
          return { status: 200, verificationStatus: "SUCCESS" };
        },
      },
      adapter: {
        getSubscription: async () => {
          throw sensitiveSdkError();
        },
      },
    });
    const payload = {
      id: `evt_${randomUUID()}`,
      event_type: "PAYMENT.SALE.COMPLETED",
      resource: {
        id: `sale_${randomUUID()}`,
        billing_agreement_id: `I-${randomUUID()}`,
        custom_id: encodePayPalCustomId({
          userId,
          planId: "paypal-privacy-plan",
        }),
        amount: { total: "10.00", currency: "USD" },
      },
    };
    const request = new Request("https://fixture.invalid/api/paypal/webhook", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": "https://fixture.invalid/cert",
        "paypal-transmission-id": "transmission",
        "paypal-transmission-sig": "signature",
        "paypal-transmission-time": new Date().toISOString(),
      },
    });
    const beforeState = await financialSnapshot();
    const { value: response, calls } = await withConsoleCapture(() => handler(request));
    const responseBody = await response.text();
    captured.flush();

    assert.equal(response.status, 500);
    assert.equal(responseBody.includes("Failed to process PayPal webhook."), true);
    assert.equal(await financialSnapshot(), beforeState);
    assertSafe("PayPal webhook HTTP body", responseBody);
    assertSafe("PayPal webhook logger and Sentry", captured.text());
    assert.equal(notification.messages.length, 1);
    assertSafe("PayPal alert email", JSON.stringify(notification.messages[0]?.reactProps));
    assert.equal(calls.length, 0);
  },
);

pgTest(
  "PayPal capture route returns a stable body after a real bound-order transport failure",
  async () => {
    await resetSyntheticData();
    const userId = await createUser();
    const orderId = `pp_${randomUUID()}`;
    await domain.paypalSource.recordPayPalSourceBinding({
      orderId,
      userId,
      organizationId: null,
      planId: "paypal-privacy-plan",
      amountTotal: 1000,
      currency: "USD",
    });
    const captured = createCapturedLogger("billing.paypal.capture.privacy-test");
    const handler = createPayPalCaptureHandler({
      app: domain.app,
      getFreshSession: async () => ({ user: { id: userId } }),
      captureOrder: async () => {
        throw sensitiveSdkError();
      },
      getOrder: async () => null,
      getLocale: async () => "en",
      schedule: () => {},
      logger: captured.logger,
    });
    const request = new Request("https://fixture.invalid/api/paypal/capture-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId }),
    });
    const beforeState = await financialSnapshot();
    const { value: response, calls } = await withConsoleCapture(() => handler(request));
    const body = await response.text();
    captured.flush();

    assert.equal(response.status, 500);
    assert.equal(body.includes("Failed to capture PayPal payment."), true);
    assert.equal(await financialSnapshot(), beforeState);
    assertSafe("PayPal capture HTTP body", body);
    assertSafe("PayPal capture logger and Sentry", captured.text());
    assert.equal(calls.length, 0);
  },
);
