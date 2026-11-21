import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import http from "node:http";
import https from "node:https";
import { dirname, resolve } from "node:path";
import { after, before, beforeEach, mock, test } from "node:test";
import { pathToFileURL } from "node:url";
import { REDACTED_LOG_VALUE } from "@/lib/logger/options";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));

function importConditionTarget(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return (
    importConditionTarget(record.import) ??
    importConditionTarget(record.default) ??
    importConditionTarget(record.node)
  );
}

/** Resolve the app's actual ESM conditional export, never its CJS require path. */
function appEsmUrl(packageName: string): string {
  const requireEntry = appRequire.resolve(packageName);
  let packageRoot = dirname(requireEntry);
  let manifest: {
    name?: string;
    module?: string;
    exports?: unknown;
  } | null = null;
  while (!manifest) {
    const manifestPath = resolve(packageRoot, "package.json");
    if (existsSync(manifestPath)) {
      const candidate = JSON.parse(readFileSync(manifestPath, "utf8")) as typeof manifest;
      if (candidate.name === packageName) manifest = candidate;
    }
    if (manifest) break;
    const parent = dirname(packageRoot);
    if (parent === packageRoot) throw new Error(`Cannot locate ${packageName}`);
    packageRoot = parent;
  }
  const rootExport =
    manifest.exports && typeof manifest.exports === "object" && "." in manifest.exports
      ? (manifest.exports as Record<string, unknown>)["."]
      : manifest.exports;
  const target =
    manifest.module ??
    importConditionTarget(
      rootExport && typeof rootExport === "object" && "import" in rootExport
        ? (rootExport as Record<string, unknown>).import
        : rootExport,
    );
  if (!target) throw new Error(`Cannot resolve ESM export for ${packageName}`);
  return pathToFileURL(resolve(packageRoot, target)).href;
}

const paypalSdkUrl = appEsmUrl("@paypal/paypal-server-sdk");
const stripeSdkUrl = appEsmUrl("stripe");
const creemSdkUrl = appEsmUrl("creem");
const realPino = appRequire("pino") as (
  options: { level: string },
  destination: { write(chunk: string): void },
) => { flush?: () => void };

const DATABASE_ENABLED = Boolean(process.env.DATABASE_URL);
const pgTest = DATABASE_ENABLED ? test : test.skip;
const MARKER_PREFIX = "SYNTHETIC_ACTION_PRIVACY_";
const PAYPAL_PORTAL_URL = "https://www.paypal.com/myaccount/autopay/";

interface SensitiveError extends Error {
  config?: { headers?: { Authorization?: string; Cookie?: string } };
  cause?: SensitiveError;
}

interface CredentialView {
  message: string;
  stack: string | undefined;
  authorization: string | undefined;
  cookie: string | undefined;
  causeMessage: string | undefined;
  causeAuthorization: string | undefined;
}

interface Actor {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin" | "superadmin";
}

const boundary = {
  marker: `${MARKER_PREFIX}BOOT`,
  paypalCancel: "throw" as "throw" | "ok",
  paypalCancels: [] as Array<{ id: string; reason?: string }>,
  paypalRefunds: [] as string[],
  paypalCreates: 0,
  stripeCalls: [] as string[],
  creemRefunds: [] as string[],
  creemPortals: [] as string[],
  fetchUrls: [] as string[],
  fetchMode: "block" as "block" | "sync-fail",
  nativeHttp: [] as string[],
  lastError: null as SensitiveError | null,
  credentialView: null as CredentialView | null,
};

const pinoLines: string[] = [];
const sentryEvents = {
  breadcrumbs: [] as unknown[],
  exceptions: [] as unknown[],
  messages: [] as unknown[],
};
const consoleCalls: unknown[][] = [];

function sensitiveError(marker: string): SensitiveError {
  const bearer = `Bearer ${marker}`;
  const databaseUrl = `postgresql://svc:${marker}@db.invalid/app`;
  const labeled = [
    `SecretAccessKey=${marker}`,
    `secret_access_key=${marker}`,
    `secret-access-key=${marker}`,
    `AccessKeyId=${marker}`,
    `access_key_id=${marker}`,
    `access-key-id=${marker}`,
    `AWS_SECRET_ACCESS_KEY=${marker}`,
    `AWS_ACCESS_KEY_ID=${marker}`,
    `authorization=${marker}`,
  ].join("; ");
  const error = new Error(
    `gateway rejected ${bearer}; ${databaseUrl}; ${labeled}`,
  ) as SensitiveError;
  error.stack = `${error.stack ?? ""}\nAuthorization: ${bearer}\nCookie: sid=${marker}\nSecretAccessKey: ${marker}`;
  const cause = new Error(
    `nested AWS_ACCESS_KEY_ID=${marker}; ${bearer}; SecretAccessKey=${marker}`,
  ) as SensitiveError;
  cause.stack = `Error: nested\nCookie: sid=${marker}\nAuthorization: ${bearer}`;
  cause.config = { headers: { Authorization: bearer, Cookie: `sid=${marker}` } };
  error.cause = cause;
  error.config = { headers: { Authorization: bearer, Cookie: `sid=${marker}` } };
  return error;
}

function credentialView(error: SensitiveError): CredentialView {
  return {
    message: error.message,
    stack: error.stack,
    authorization: error.config?.headers?.Authorization,
    cookie: error.config?.headers?.Cookie,
    causeMessage: error.cause?.message,
    causeAuthorization: error.cause?.config?.headers?.Authorization,
  };
}

function throwSensitive(): never {
  const error = sensitiveError(boundary.marker);
  boundary.lastError = error;
  boundary.credentialView = credentialView(error);
  throw error;
}

function resetBoundary(marker = `${MARKER_PREFIX}${crypto.randomUUID()}`): void {
  boundary.marker = marker;
  boundary.paypalCancel = "throw";
  boundary.paypalCancels.length = 0;
  boundary.paypalRefunds.length = 0;
  boundary.paypalCreates = 0;
  boundary.stripeCalls.length = 0;
  boundary.creemRefunds.length = 0;
  boundary.creemPortals.length = 0;
  boundary.fetchUrls.length = 0;
  boundary.fetchMode = "block";
  boundary.nativeHttp.length = 0;
  boundary.lastError = null;
  boundary.credentialView = null;
  pinoLines.length = 0;
  sentryEvents.breadcrumbs.length = 0;
  sentryEvents.exceptions.length = 0;
  sentryEvents.messages.length = 0;
  consoleCalls.length = 0;
}

class PayPalClient {}

class SubscriptionsController {
  async cancelSubscription(input: { id: string; body?: { reason?: string } }): Promise<void> {
    boundary.paypalCancels.push({ id: input.id, reason: input.body?.reason });
    if (boundary.paypalCancel === "ok") return;
    throwSensitive();
  }

  async createSubscription(): Promise<never> {
    boundary.paypalCreates += 1;
    throwSensitive();
  }

  async getBillingPlan(): Promise<never> {
    throwSensitive();
  }

  async suspendSubscription(): Promise<never> {
    throwSensitive();
  }

  async activateSubscription(): Promise<never> {
    throwSensitive();
  }
}

class PaymentsController {
  async refundCapturedPayment(input: { captureId: string }): Promise<never> {
    boundary.paypalRefunds.push(input.captureId);
    throwSensitive();
  }

  async getCapturedPayment(): Promise<never> {
    throwSensitive();
  }
}

class OrdersController {
  async createOrder(): Promise<never> {
    throwSensitive();
  }

  async captureOrder(): Promise<never> {
    throwSensitive();
  }

  async getOrder(): Promise<never> {
    throwSensitive();
  }
}

class StripeSdk {
  constructor(_key: string, _options?: unknown) {}

  customers = {
    retrieve: async (): Promise<never> => {
      boundary.stripeCalls.push("customers.retrieve");
      throwSensitive();
    },
    create: async (): Promise<never> => {
      boundary.stripeCalls.push("customers.create");
      throwSensitive();
    },
  };

  checkout = {
    sessions: {
      list: async (): Promise<{ data: [] }> => {
        boundary.stripeCalls.push("checkout.sessions.list");
        return { data: [] };
      },
      create: async (): Promise<never> => {
        boundary.stripeCalls.push("checkout.sessions.create");
        throwSensitive();
      },
      expire: async (): Promise<never> => {
        boundary.stripeCalls.push("checkout.sessions.expire");
        throwSensitive();
      },
    },
  };

  billingPortal = {
    sessions: {
      create: async (): Promise<never> => {
        boundary.stripeCalls.push("billingPortal.sessions.create");
        throwSensitive();
      },
    },
  };

  refunds = {
    create: async (): Promise<never> => {
      boundary.stripeCalls.push("refunds.create");
      throwSensitive();
    },
  };

  promotionCodes = {
    list: async (): Promise<{ data: [] }> => {
      boundary.stripeCalls.push("promotionCodes.list");
      return { data: [] };
    },
  };
}

class CreemSdk {
  constructor(_options?: unknown) {}

  transactions = {
    refund: async (input: { transactionId: string }): Promise<never> => {
      boundary.creemRefunds.push(input.transactionId);
      throwSensitive();
    },
  };

  customers = {
    generateBillingLinks: async (input: { customerId: string }): Promise<never> => {
      boundary.creemPortals.push(input.customerId);
      throwSensitive();
    },
  };

  checkouts = {
    create: async (): Promise<never> => {
      throwSensitive();
    },
  };

  subscriptions = {
    cancel: async (): Promise<never> => {
      throwSensitive();
    },
    get: async (): Promise<never> => {
      throwSensitive();
    },
  };
}

let actor: Actor | null = null;

mock.module("@/lib/auth/server", {
  exports: {
    getSession: async () =>
      actor
        ? {
            user: {
              id: actor.id,
              email: actor.email,
              name: actor.name,
              role: actor.role,
            },
          }
        : null,
    getFreshSession: async () => null,
    getWorkspaceContext: async () => null,
    isAdmin: async () => actor?.role === "admin" || actor?.role === "superadmin",
    isSuperAdmin: async () => actor?.role === "superadmin",
  },
});

mock.module(appRequire.resolve("server-only"), { exports: {} });

mock.module(appRequire.resolve("next-intl/server"), {
  exports: {
    getLocale: async () => "en",
    getTranslations: async () => (key: string) => key,
  },
});

mock.module(paypalSdkUrl, {
  exports: {
    ApplicationContextUserAction: { SubscribeNow: "SUBSCRIBE_NOW" },
    CheckoutPaymentIntent: { Capture: "CAPTURE" },
    Client: PayPalClient,
    Environment: { Production: "Production", Sandbox: "Sandbox" },
    OrderApplicationContextShippingPreference: { NoShipping: "NO_SHIPPING" },
    OrdersController,
    PaymentsController,
    SubscriptionsController,
  },
});

mock.module(stripeSdkUrl, {
  exports: { default: StripeSdk },
});

mock.module(creemSdkUrl, {
  exports: { Creem: CreemSdk },
});

mock.module(appRequire.resolve("@sentry/nextjs"), {
  exports: {
    addBreadcrumb(breadcrumb: unknown) {
      sentryEvents.breadcrumbs.push(breadcrumb);
    },
    captureException(error: unknown, context: unknown) {
      sentryEvents.exceptions.push({ error, context });
      return undefined;
    },
    captureMessage(message: unknown, context: unknown) {
      sentryEvents.messages.push({ message, context });
      return undefined;
    },
  },
});

if (process.env.NODE_ENV === "development") process.env.NODE_ENV = "test";
delete process.env.LOG_DIR;
delete process.env.NEXT_RUNTIME;
process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID = "synthetic-paypal-client-id";
process.env.PAYPAL_CLIENT_SECRET = "synthetic-paypal-client-secret";
process.env.NEXT_PUBLIC_PAYPAL_ENVIRONMENT = "sandbox";
process.env.STRIPE_SECRET_KEY = "sk_test_synthetic_action_privacy";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_synthetic_action_privacy";
process.env.CREEM_API_KEY = "creem_test_synthetic_action_privacy";
process.env.CREEM_WEBHOOK_SECRET = "whsec_synthetic_creem_action_privacy";
process.env.NEXT_PUBLIC_SITE_URL = "http://127.0.0.1:3000";
delete process.env.DISABLE_PURCHASE;

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalFetch = globalThis.fetch;
const originalHttpsRequest = https.request;
const originalHttpRequest = http.request;
const originalHttpsGet = https.get;
const originalHttpGet = http.get;

function chunkText(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (Buffer.isBuffer(chunk)) return chunk.toString("utf8");
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString("utf8");
  return String(chunk);
}

process.stdout.write = ((
  chunk: string | Uint8Array,
  encoding?: BufferEncoding | ((error?: Error | null) => void),
  callback?: (error?: Error | null) => void,
) => {
  pinoLines.push(chunkText(chunk));
  return originalStdoutWrite(chunk, encoding as BufferEncoding, callback);
}) as typeof process.stdout.write;

function requestTarget(args: unknown[]): string {
  const first = args[0];
  if (typeof first === "string" || first instanceof URL) return String(first);
  if (first && typeof first === "object") {
    const options = first as { protocol?: string; hostname?: string; host?: string; path?: string };
    return `${options.protocol ?? ""}//${options.hostname ?? options.host ?? ""}${options.path ?? ""}`;
  }
  return "unknown";
}

function blockNative(kind: string, args: unknown[]): never {
  const target = requestTarget(args);
  boundary.nativeHttp.push(`${kind} ${target}`);
  throw new Error(`Blocked native ${kind}`);
}

https.request = ((...args: unknown[]) =>
  blockNative("https.request", args)) as typeof https.request;
http.request = ((...args: unknown[]) => blockNative("http.request", args)) as typeof http.request;
https.get = ((...args: unknown[]) => blockNative("https.get", args)) as typeof https.get;
http.get = ((...args: unknown[]) => blockNative("http.get", args)) as typeof http.get;

function fetchUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

globalThis.fetch = async (
  input: Parameters<typeof fetch>[0],
  _init?: Parameters<typeof fetch>[1],
) => {
  const url = fetchUrl(input);
  boundary.fetchUrls.push(url);
  if (boundary.fetchMode === "sync-fail") {
    const host = new URL(url).host;
    if (host !== "api-m.sandbox.paypal.com") {
      boundary.nativeHttp.push(`fetch ${host}`);
      throw new Error("Blocked non-sandbox PayPal fetch");
    }
    return new Response(sensitiveError(boundary.marker).message, { status: 500 });
  }
  boundary.nativeHttp.push(`fetch ${url}`);
  throw new Error("Blocked external fetch");
};

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item instanceof Error) {
      const cause = item.cause;
      return {
        name: item.name,
        message: item.message,
        stack: item.stack,
        cause: cause instanceof Error ? { message: cause.message, stack: cause.stack } : cause,
        ...item,
      };
    }
    return item;
  });
}

function assertNoMarkers(label: string, value: string, markers: string[]): void {
  for (const marker of markers) {
    assert.equal(value.includes(marker), false, `${label} contained a synthetic credential`);
  }
}

function installConsoleCapture(): () => void {
  const previous = {
    error: console.error,
    warn: console.warn,
    log: console.log,
    info: console.info,
  };
  const push =
    (level: string) =>
    (...args: unknown[]) => {
      consoleCalls.push([level, ...args]);
    };
  console.error = push("error");
  console.warn = push("warn");
  console.log = push("log");
  console.info = push("info");
  return () => {
    console.error = previous.error;
    console.warn = previous.warn;
    console.log = previous.log;
    console.info = previous.info;
  };
}

function assertLoggedAndClean(markers: string[], pinoFrom: number, sentryFrom: number): void {
  const pinoText = pinoLines.slice(pinoFrom).join("\n");
  const sentryText = serialize({
    exceptions: sentryEvents.exceptions.slice(sentryFrom),
    messages: sentryEvents.messages.slice(sentryFrom),
    breadcrumbs: sentryEvents.breadcrumbs.slice(sentryFrom),
  });
  const consoleText = serialize(consoleCalls);
  assert.match(pinoText, /"level":"error"/);
  assert.ok(sentryEvents.exceptions.length > sentryFrom);
  assert.equal(pinoText.includes(REDACTED_LOG_VALUE), true);
  assert.equal(sentryText.includes(REDACTED_LOG_VALUE), true);
  assertNoMarkers("pino", pinoText, markers);
  assertNoMarkers("sentry", sentryText, markers);
  assertNoMarkers("console", consoleText, markers);
  assert.equal(boundary.nativeHttp.length, 0);
}

function assertCredentialsUnchanged(): void {
  assert.ok(boundary.lastError);
  assert.ok(boundary.credentialView);
  assert.deepEqual(credentialView(boundary.lastError), boundary.credentialView);
}

async function financialState(): Promise<string> {
  const { db } = await import("@/lib/db");
  const schema = await import("@/lib/db/schema");
  const [subscriptions, orders, balances, organizationBalances, ledger, users] = await Promise.all([
    db
      .select({
        userId: schema.subscriptions.userId,
        status: schema.subscriptions.status,
        provider: schema.subscriptions.provider,
        providerSubscriptionId: schema.subscriptions.providerSubscriptionId,
        monthlyCredits: schema.subscriptions.monthlyCredits,
        remainingGrants: schema.subscriptions.remainingGrants,
        cancelAtPeriodEnd: schema.subscriptions.cancelAtPeriodEnd,
        canceledAt: schema.subscriptions.canceledAt,
      })
      .from(schema.subscriptions)
      .orderBy(schema.subscriptions.providerSubscriptionId),
    db
      .select({
        status: schema.orders.status,
        amountTotal: schema.orders.amountTotal,
        amountRefunded: schema.orders.amountRefunded,
        provider: schema.orders.provider,
        providerPaymentId: schema.orders.providerPaymentId,
        refundedAt: schema.orders.refundedAt,
      })
      .from(schema.orders)
      .orderBy(schema.orders.providerOrderId),
    db.select().from(schema.creditBalances).orderBy(schema.creditBalances.userId),
    db
      .select()
      .from(schema.organizationCreditBalances)
      .orderBy(schema.organizationCreditBalances.organizationId),
    db.select().from(schema.creditTransactions).orderBy(schema.creditTransactions.id),
    db
      .select({
        id: schema.user.id,
        stripeCustomerId: schema.user.stripeCustomerId,
        paypalPayerId: schema.user.paypalPayerId,
      })
      .from(schema.user)
      .orderBy(schema.user.email),
  ]);
  return JSON.stringify({
    subscriptions,
    orders,
    balances,
    organizationBalances,
    ledger,
    users,
  });
}

async function createActor(role: Actor["role"]): Promise<Actor> {
  const { db } = await import("@/lib/db");
  const { user } = await import("@/lib/db/schema");
  const [row] = await db
    .insert(user)
    .values({
      email: `${crypto.randomUUID()}@example.invalid`,
      name: "Privacy actor",
      role,
      stripeCustomerId: `cus_synthetic_${crypto.randomUUID()}`,
    })
    .returning({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? "Privacy actor",
    role: row.role,
  };
}

async function insertBalance(userId: string): Promise<void> {
  const { db } = await import("@/lib/db");
  const { creditBalances } = await import("@/lib/db/schema");
  await db.insert(creditBalances).values({
    userId,
    subscriptionCredits: 80,
    purchasedCredits: 15,
  });
}

async function insertSubscription(input: {
  userId: string;
  provider: "paypal" | "stripe" | "creem";
  providerSubscriptionId: string;
  providerCustomerId?: string;
}): Promise<void> {
  const { db } = await import("@/lib/db");
  const { subscriptions } = await import("@/lib/db/schema");
  await db.insert(subscriptions).values({
    userId: input.userId,
    planId: "starter-monthly",
    provider: input.provider,
    providerSubscriptionId: input.providerSubscriptionId,
    providerCustomerId: input.providerCustomerId,
    status: "active",
    interval: "month",
    monthlyCredits: 500,
    remainingGrants: 2,
  });
}

async function insertOrder(input: {
  userId: string;
  provider: "paypal" | "stripe" | "creem";
  providerPaymentId: string;
}): Promise<string> {
  const { db } = await import("@/lib/db");
  const { orders } = await import("@/lib/db/schema");
  const [row] = await db
    .insert(orders)
    .values({
      userId: input.userId,
      planId: "pack-mini",
      orderType: "one_time",
      status: "completed",
      creditsGranted: 300,
      amountTotal: 1000,
      amountRefunded: 0,
      currency: "usd",
      provider: input.provider,
      providerOrderId: `order_${crypto.randomUUID()}`,
      providerPaymentId: input.providerPaymentId,
    })
    .returning({ id: orders.id });
  return row.id;
}

before(async () => {
  if (!DATABASE_ENABLED) return;
  const { migrate } = await import("./helpers");
  await migrate();
});

beforeEach(async () => {
  actor = null;
  resetBoundary();
  if (!DATABASE_ENABLED) return;
  const { resetSyntheticData } = await import("./helpers");
  await resetSyntheticData();
});

after(async () => {
  process.stdout.write = originalStdoutWrite;
  globalThis.fetch = originalFetch;
  https.request = originalHttpsRequest;
  http.request = originalHttpRequest;
  https.get = originalHttpsGet;
  http.get = originalHttpGet;
  if (!DATABASE_ENABLED) return;
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
});

test("provider controller boundaries throw synthetic errors without native HTTP", async () => {
  const marker = boundary.marker;
  const paypal = await import("@/lib/paypal/client");
  await assert.rejects(
    () => paypal.cancelPayPalSubscription("I-SYNTHETIC", "customer request"),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.equal((error as Error).message.includes(marker), true);
      return true;
    },
  );
  assert.equal(boundary.paypalCancels.length, 1);
  assert.deepEqual(boundary.paypalCancels[0], {
    id: "I-SYNTHETIC",
    reason: "customer request",
  });

  const stripe = await import("@/lib/stripe");
  await assert.rejects(() => stripe.getStripe().refunds.create({ payment_intent: "pi_synthetic" }));
  assert.equal(boundary.stripeCalls.at(-1), "refunds.create");

  const creem = await import("@/lib/creem/client");
  await assert.rejects(
    () => creem.refundCreemTransaction("txn_synthetic"),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.equal((error as Error).message.includes(marker), true);
      return true;
    },
  );
  assert.deepEqual(boundary.creemRefunds, ["txn_synthetic"]);
  assert.equal(boundary.fetchUrls.length, 0);
  assert.equal(boundary.nativeHttp.length, 0);
  assertCredentialsUnchanged();
});

test("createLogger redacts AWS credential text, bearer headers, and database URLs", async () => {
  const marker = `${MARKER_PREFIX}LOGGER_${crypto.randomUUID()}`;
  const lines: string[] = [];
  const localSentry = {
    breadcrumbs: [] as unknown[],
    exceptions: [] as unknown[],
    messages: [] as unknown[],
  };
  const pinoLogger = realPino(
    { level: "debug" },
    {
      write(chunk: string) {
        lines.push(chunkText(chunk));
      },
    },
  );
  const { createLogger } = await import("@/lib/logger");
  const logger = createLogger("commerce.action.privacy", {
    pino: pinoLogger,
    sentry: {
      addBreadcrumb(breadcrumb) {
        localSentry.breadcrumbs.push(breadcrumb);
      },
      captureException(error, context) {
        localSentry.exceptions.push({ error, context });
        return undefined;
      },
      captureMessage(message, context) {
        localSentry.messages.push({ message, context });
        return undefined;
      },
    },
  });
  const error = sensitiveError(marker);
  const beforeView = credentialView(error);
  logger.trace({ err: error, Authorization: `Bearer ${marker}` }, `SecretAccessKey=${marker}`);
  logger.debug({ err: error }, `access_key_id=${marker}`);
  logger.info({ err: error }, `access-key-id=${marker}`);
  logger.warn({ err: error, Cookie: `sid=${marker}` }, `AWS_SECRET_ACCESS_KEY=${marker}`);
  logger.error({ err: error }, `AWS_ACCESS_KEY_ID=${marker}`);
  logger.error(error);
  logger.fatal({ err: error }, `secret-access-key=${marker}`);
  logger.captureError(error, {
    Authorization: `Bearer ${marker}`,
    note: `postgresql://svc:${marker}@db.invalid/app SecretAccessKey=${marker}`,
  });
  pinoLogger.flush?.();

  const rendered = serialize({ pino: lines, sentry: localSentry });
  assertNoMarkers("createLogger sinks", rendered, [marker]);
  assert.equal(rendered.includes(REDACTED_LOG_VALUE), true);
  assert.equal("pino" in logger, false);
  assert.deepEqual(credentialView(error), beforeView);
});

test("closed checkout returns before auth, database, and provider SDKs", async () => {
  const previous = process.env.DISABLE_PURCHASE;
  delete process.env.DISABLE_PURCHASE;
  const stripeBefore = boundary.stripeCalls.length;
  const paypalBefore = boundary.paypalCancels.length + boundary.paypalCreates;
  try {
    const { createCheckoutSession } = await import("@/actions/billing/checkout");
    const result = await createCheckoutSession({ planId: "starter-monthly" });
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error, "Checkout is not available yet.");
    assert.equal(result.customCode, "CHECKOUT_DISABLED");
    assert.equal(boundary.stripeCalls.length, stripeBefore);
    assert.equal(boundary.paypalCancels.length + boundary.paypalCreates, paypalBefore);
    assert.equal(boundary.creemRefunds.length, 0);
    assert.equal(boundary.fetchUrls.length, 0);
    assert.equal(boundary.nativeHttp.length, 0);
  } finally {
    if (previous === undefined) delete process.env.DISABLE_PURCHASE;
    else process.env.DISABLE_PURCHASE = previous;
  }
});

pgTest("PayPal cancel failure keeps the subscription and hides provider credentials", async () => {
  const owner = await createActor("user");
  const stranger = await createActor("user");
  await insertBalance(owner.id);
  const subscriptionId = `I-${crypto.randomUUID()}`;
  await insertSubscription({
    userId: owner.id,
    provider: "paypal",
    providerSubscriptionId: subscriptionId,
  });
  const before = await financialState();
  const { cancelPayPalSubscriptionAction } = await import("@/actions/paypal");
  const restoreConsole = installConsoleCapture();
  try {
    actor = null;
    const anonymous = await cancelPayPalSubscriptionAction(subscriptionId, "anonymous");
    assert.equal(anonymous.success, false);
    if (!anonymous.success) assert.equal(anonymous.error, "User not authenticated.");
    assert.equal(boundary.paypalCancels.length, 0);

    actor = stranger;
    const forbidden = await cancelPayPalSubscriptionAction(subscriptionId, "stranger");
    assert.equal(forbidden.success, false);
    if (!forbidden.success)
      assert.equal(forbidden.error, "Only the subscription owner can cancel it.");
    assert.equal(boundary.paypalCancels.length, 0);

    actor = owner;
    const missing = await cancelPayPalSubscriptionAction("I-MISSING", "missing");
    assert.equal(missing.success, false);
    if (!missing.success) assert.equal(missing.error, "Subscription not found.");
    assert.equal(boundary.paypalCancels.length, 0);

    const firstMarker = `${MARKER_PREFIX}CANCEL_A_${crypto.randomUUID()}`;
    const secondMarker = `${MARKER_PREFIX}CANCEL_B_${crypto.randomUUID()}`;
    boundary.marker = firstMarker;
    const pinoFrom = pinoLines.length;
    const sentryFrom = sentryEvents.exceptions.length;
    const first = await cancelPayPalSubscriptionAction(subscriptionId, "first failure");
    boundary.marker = secondMarker;
    const second = await cancelPayPalSubscriptionAction(subscriptionId, "second failure");
    assert.equal(first.success, false);
    assert.equal(second.success, false);
    if (!first.success && !second.success) {
      assert.equal(first.error, second.error);
      assert.equal(first.error.length > 0, true);
      assertNoMarkers("cancel action", serialize(first), [firstMarker, secondMarker]);
      assertNoMarkers("cancel action", serialize(second), [firstMarker, secondMarker]);
      assert.equal(first.error.includes("gateway rejected"), false);
    }
    assert.equal(boundary.paypalCancels.length, 2);
    assertLoggedAndClean([firstMarker, secondMarker], pinoFrom, sentryFrom);
    assertCredentialsUnchanged();
    assert.equal(await financialState(), before);
    assert.equal(boundary.fetchUrls.length, 0);
  } finally {
    restoreConsole();
  }
});

pgTest("PayPal cancel stays successful when the post-cancel source sync fails", async () => {
  const owner = await createActor("user");
  await insertBalance(owner.id);
  const subscriptionId = `I-${crypto.randomUUID()}`;
  await insertSubscription({
    userId: owner.id,
    provider: "paypal",
    providerSubscriptionId: subscriptionId,
  });
  const before = await financialState();
  boundary.paypalCancel = "ok";
  boundary.fetchMode = "sync-fail";
  const marker = boundary.marker;
  actor = owner;
  const { cancelPayPalSubscriptionAction } = await import("@/actions/paypal");
  const restoreConsole = installConsoleCapture();
  try {
    const pinoFrom = pinoLines.length;
    const sentryFrom = sentryEvents.exceptions.length;
    const result = await cancelPayPalSubscriptionAction(subscriptionId, "sync fails");
    assert.equal(result.success, true);
    if (result.success) {
      assert.deepEqual(result.data, { canceled: true });
      assert.equal(result.customCode, undefined);
    }
    assert.equal(boundary.paypalCancels.length, 1);
    assert.equal(boundary.fetchUrls.length, 1);
    assert.equal(new URL(boundary.fetchUrls[0]).host, "api-m.sandbox.paypal.com");
    assertLoggedAndClean([marker], pinoFrom, sentryFrom);
    assert.equal(serialize(result).includes(marker), false);
    assert.equal(await financialState(), before);
  } finally {
    restoreConsole();
  }
});

pgTest("PayPal portal returns the static autopay page without calling PayPal", async () => {
  const owner = await createActor("user");
  await insertSubscription({
    userId: owner.id,
    provider: "paypal",
    providerSubscriptionId: `I-${crypto.randomUUID()}`,
  });
  const before = await financialState();
  actor = owner;
  const { createCustomerPortalSession } = await import("@/actions/billing/portal");
  const result = await createCustomerPortalSession();
  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data, { url: PAYPAL_PORTAL_URL });
    assert.equal(result.customCode, undefined);
  }
  assert.equal(boundary.paypalCancels.length, 0);
  assert.equal(boundary.paypalCreates, 0);
  assert.equal(boundary.fetchUrls.length, 0);
  assert.equal(boundary.nativeHttp.length, 0);
  assert.equal(await financialState(), before);
});

pgTest(
  "Stripe checkout and portal SDK failures do not write billing state or credentials",
  async () => {
    const owner = await createActor("user");
    await insertBalance(owner.id);
    const before = await financialState();
    actor = owner;
    const previousPurchase = process.env.DISABLE_PURCHASE;
    process.env.DISABLE_PURCHASE = "false";
    const { createCheckoutSession } = await import("@/actions/billing/checkout");
    const { createCustomerPortalSession } = await import("@/actions/billing/portal");
    const restoreConsole = installConsoleCapture();
    try {
      const checkoutMarker = `${MARKER_PREFIX}CHECKOUT_${crypto.randomUUID()}`;
      boundary.marker = checkoutMarker;
      const checkoutLog = pinoLines.length;
      const checkoutSentry = sentryEvents.exceptions.length;
      const checkout = await createCheckoutSession({ planId: "starter-monthly" });
      assert.equal(checkout.success, false);
      if (!checkout.success) {
        assert.equal(checkout.error.includes("gateway rejected"), false);
        assertNoMarkers("checkout action", serialize(checkout), [checkoutMarker]);
      }
      assert.equal(boundary.stripeCalls[0], "customers.retrieve");
      assertLoggedAndClean([checkoutMarker], checkoutLog, checkoutSentry);
      assert.equal(await financialState(), before);

      const portalMarker = `${MARKER_PREFIX}PORTAL_${crypto.randomUUID()}`;
      boundary.marker = portalMarker;
      const portalLog = pinoLines.length;
      const portalSentry = sentryEvents.exceptions.length;
      const portal = await createCustomerPortalSession();
      assert.equal(portal.success, false);
      if (!portal.success) {
        assert.equal(portal.error.includes("gateway rejected"), false);
        assertNoMarkers("portal action", serialize(portal), [portalMarker]);
      }
      assert.equal(boundary.stripeCalls.at(-1), "billingPortal.sessions.create");
      assertLoggedAndClean([portalMarker], portalLog, portalSentry);
      assert.equal(await financialState(), before);
      assert.equal(boundary.fetchUrls.length, 0);
    } finally {
      restoreConsole();
      if (previousPurchase === undefined) delete process.env.DISABLE_PURCHASE;
      else process.env.DISABLE_PURCHASE = previousPurchase;
    }
  },
);

pgTest("Creem portal SDK failure keeps the local subscription and hides credentials", async () => {
  const owner = await createActor("user");
  await insertBalance(owner.id);
  const customerId = `cust_${crypto.randomUUID()}`;
  await insertSubscription({
    userId: owner.id,
    provider: "creem",
    providerSubscriptionId: `sub_${crypto.randomUUID()}`,
    providerCustomerId: customerId,
  });
  const before = await financialState();
  actor = owner;
  const marker = boundary.marker;
  const { createCustomerPortalSession } = await import("@/actions/billing/portal");
  const restoreConsole = installConsoleCapture();
  try {
    const pinoFrom = pinoLines.length;
    const sentryFrom = sentryEvents.exceptions.length;
    const result = await createCustomerPortalSession();
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.includes(marker), false);
      assert.equal(result.error.includes("gateway rejected"), false);
    }
    assert.deepEqual(boundary.creemPortals, [customerId]);
    assertLoggedAndClean([marker], pinoFrom, sentryFrom);
    assert.equal(await financialState(), before);
  } finally {
    restoreConsole();
  }
});

pgTest("admin refund SDK failures leave orders, balances, and ledger unchanged", async () => {
  const admin = await createActor("admin");
  const member = await createActor("user");
  await insertBalance(member.id);
  const paypalPaymentId = `CAP-${crypto.randomUUID()}`;
  const stripePaymentId = `pi_${crypto.randomUUID()}`;
  const creemPaymentId = `txn_${crypto.randomUUID()}`;
  const paypalOrderId = await insertOrder({
    userId: member.id,
    provider: "paypal",
    providerPaymentId: paypalPaymentId,
  });
  const stripeOrderId = await insertOrder({
    userId: member.id,
    provider: "stripe",
    providerPaymentId: stripePaymentId,
  });
  const creemOrderId = await insertOrder({
    userId: member.id,
    provider: "creem",
    providerPaymentId: creemPaymentId,
  });
  const before = await financialState();
  const { refundOrder } = await import("@/actions/orders/admin");
  const restoreConsole = installConsoleCapture();
  try {
    actor = member;
    const forbidden = await refundOrder({ orderId: paypalOrderId });
    assert.equal(forbidden.success, false);
    if (!forbidden.success) assert.equal(forbidden.error, "Forbidden");
    assert.equal(boundary.paypalRefunds.length, 0);
    assert.equal(boundary.stripeCalls.length, 0);
    assert.equal(boundary.creemRefunds.length, 0);

    actor = null;
    const anonymous = await refundOrder({ orderId: paypalOrderId });
    assert.equal(anonymous.success, false);
    if (!anonymous.success) assert.equal(anonymous.error, "Forbidden");
    assert.equal(boundary.paypalRefunds.length, 0);

    actor = admin;
    const cases = [
      {
        orderId: paypalOrderId,
        marker: `${MARKER_PREFIX}REFUND_PAYPAL_${crypto.randomUUID()}`,
        calls: () => boundary.paypalRefunds.length,
      },
      {
        orderId: stripeOrderId,
        marker: `${MARKER_PREFIX}REFUND_STRIPE_${crypto.randomUUID()}`,
        calls: () => boundary.stripeCalls.length,
      },
      {
        orderId: creemOrderId,
        marker: `${MARKER_PREFIX}REFUND_CREEM_${crypto.randomUUID()}`,
        calls: () => boundary.creemRefunds.length,
      },
    ];
    const responses: string[] = [];
    for (const entry of cases) {
      boundary.marker = entry.marker;
      const callsBefore = entry.calls();
      const pinoFrom = pinoLines.length;
      const sentryFrom = sentryEvents.exceptions.length;
      const result = await refundOrder({ orderId: entry.orderId });
      assert.equal(result.success, false);
      if (!result.success) {
        responses.push(result.error);
        assert.equal(result.error.includes("gateway rejected"), false);
        assertNoMarkers("refund action", serialize(result), [entry.marker]);
      }
      assert.equal(entry.calls(), callsBefore + 1);
      assertLoggedAndClean([entry.marker], pinoFrom, sentryFrom);
      assertCredentialsUnchanged();
      assert.equal(await financialState(), before);
    }
    const paypalAgainMarker = `${MARKER_PREFIX}REFUND_PAYPAL_AGAIN_${crypto.randomUUID()}`;
    boundary.marker = paypalAgainMarker;
    const againLog = pinoLines.length;
    const againSentry = sentryEvents.exceptions.length;
    const again = await refundOrder({ orderId: paypalOrderId });
    assert.equal(again.success, false);
    if (!again.success) {
      assert.equal(again.error, responses[0]);
      assertNoMarkers("refund action", serialize(again), [paypalAgainMarker, cases[0].marker]);
    }
    assertLoggedAndClean([paypalAgainMarker], againLog, againSentry);
    assert.equal(await financialState(), before);
    assert.equal(boundary.paypalRefunds[0], paypalPaymentId);
    assert.equal(boundary.paypalRefunds[1], paypalPaymentId);
    assert.equal(boundary.stripeCalls.at(-1), "refunds.create");
    assert.equal(boundary.creemRefunds[0], creemPaymentId);
    assert.equal(boundary.fetchUrls.length, 0);
  } finally {
    restoreConsole();
  }
});
