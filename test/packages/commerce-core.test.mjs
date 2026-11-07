import { AsyncLocalStorage } from "node:async_hooks";
/* global Headers, URL, crypto, structuredClone */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import Stripe from "stripe";

import {
  DuplicateRefundFailedError,
  InsufficientCreditsError,
  PermanentFulfillmentError,
  RefundHistoryIncompleteError,
  buildSourceIdentityCatalog,
  commerceBillingReads,
  createCommerce,
} from "../../packages/commerce/dist/index.js";
import { createCreemProvider } from "../../packages/commerce/dist/providers/creem.js";
import {
  verifyPayPalWebhookSignature,
  createPayPalProvider,
} from "../../packages/commerce/dist/providers/paypal.js";
import { createStripeProvider } from "../../packages/commerce/dist/providers/stripe.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkgRoot = join(repoRoot, "packages", "commerce");
const ENTITLED = ["active", "trialing", "past_due", "unpaid"];

function id() {
  return crypto.randomUUID();
}

function createMemoryStore() {
  const state = {
    seq: 0,
    balances: {},
    ledger: [],
    orders: [],
    subscriptions: [],
    users: {},
    orgs: {},
    members: [],
  };
  let failBalanceWrites = 0;
  let queue = Promise.resolve();
  let current = null;
  const active = new AsyncLocalStorage();
  const nextSeq = () => {
    state.seq += 1;
    return `row-${state.seq}`;
  };
  const keyOf = (subject) =>
    subject.organizationId ? `org:${subject.organizationId}` : `user:${subject.userId}`;
  const copy = (row) => ({
    ...row,
    metadata: row.metadata ? { ...row.metadata } : (row.metadata ?? null),
  });
  const snapshot = () => structuredClone(state);
  const restore = (saved) => {
    state.seq = saved.seq;
    state.balances = saved.balances;
    state.ledger = saved.ledger;
    state.orders = saved.orders;
    state.subscriptions = saved.subscriptions;
    state.users = saved.users;
    state.orgs = saved.orgs;
    state.members = saved.members;
  };
  const personal = (userId) =>
    state.subscriptions.filter((row) => row.userId === userId && row.organizationId == null);
  const orgRows = (organizationId) =>
    state.subscriptions.filter((row) => row.organizationId === organizationId);

  function unit() {
    return {
      balances: {
        async lock(subject) {
          const key = keyOf(subject);
          if (!state.balances[key]) state.balances[key] = { subscription: 0, purchased: 0 };
          return { ...state.balances[key] };
        },
        async write(subject, next) {
          if (failBalanceWrites > 0) {
            failBalanceWrites -= 1;
            throw new Error("credit write blocked by test");
          }
          state.balances[keyOf(subject)] = {
            subscription: next.subscription,
            purchased: next.purchased,
          };
        },
        async read(subject) {
          return { ...(state.balances[keyOf(subject)] ?? { subscription: 0, purchased: 0 }) };
        },
      },
      ledger: {
        async append(entry) {
          const row = { ...entry, id: nextSeq() };
          state.ledger.push(row);
          return { id: row.id };
        },
        async findUsage(entryId) {
          const row = state.ledger.find((item) => item.id === entryId && item.type === "usage");
          return row
            ? {
                userId: row.userId,
                organizationId: row.organizationId,
                subscriptionDelta: row.subscriptionDelta,
                purchasedDelta: row.purchasedDelta,
              }
            : null;
        },
        async findRefundOf(spendTxId) {
          const row = state.ledger.find((item) => item.refundedTransactionId === spendTxId);
          return row ? { id: row.id } : null;
        },
        async hasSignupBonus(userId) {
          return state.ledger.some(
            (item) => item.userId === userId && item.type === "signup_bonus",
          );
        },
        async sumSubscriptionGrantsSince(subject, since) {
          return state.ledger
            .filter(
              (item) =>
                item.type === "subscription_grant" &&
                item.createdAt >= since &&
                (subject.organizationId
                  ? item.organizationId === subject.organizationId
                  : item.userId === subject.userId && item.organizationId == null),
            )
            .reduce((sum, item) => sum + item.subscriptionDelta, 0);
        },
      },
      orders: {
        async insertIfAbsent(draft) {
          if (
            state.orders.some(
              (row) =>
                row.provider === draft.provider && row.providerOrderId === draft.providerOrderId,
            )
          )
            return null;
          const row = {
            ...draft,
            id: nextSeq(),
            amountRefunded: 0,
            refundedAt: null,
            metadata: draft.metadata ? { ...draft.metadata } : null,
          };
          state.orders.push(row);
          return { id: row.id };
        },
        async lockById(orderId) {
          const row = state.orders.find((item) => item.id === orderId);
          return row ? copy(row) : null;
        },
        async findByProviderOrder(provider, providerOrderId) {
          const row = state.orders.find(
            (item) => item.provider === provider && item.providerOrderId === providerOrderId,
          );
          return row ? copy(row) : null;
        },
        async lockByProviderOrder(provider, providerOrderId) {
          return this.findByProviderOrder(provider, providerOrderId);
        },
        async findFirstByProviderPayment(provider, providerPaymentId) {
          const row = state.orders.find(
            (item) => item.provider === provider && item.providerPaymentId === providerPaymentId,
          );
          return row ? copy(row) : null;
        },
        async update(orderId, patch) {
          const row = state.orders.find((item) => item.id === orderId);
          if (!row) throw new Error("missing order");
          Object.assign(row, patch, {
            metadata: patch.metadata ? { ...patch.metadata } : row.metadata,
          });
        },
        async listBySubscription(provider, providerSubscriptionId) {
          return state.orders
            .filter(
              (row) =>
                row.provider === provider && row.providerSubscriptionId === providerSubscriptionId,
            )
            .map(copy);
        },
        async listPayPalBindings(orderId, captureId) {
          return state.orders
            .filter((row) => {
              if (row.provider !== "paypal" || row.orderType !== "one_time") return false;
              const pinned = row.metadata?.paypalOrderId;
              const byOrder = orderId && (row.providerOrderId === orderId || pinned === orderId);
              const byCapture =
                captureId &&
                (row.providerOrderId === captureId || row.providerPaymentId === captureId);
              return Boolean(byOrder || byCapture);
            })
            .slice(0, 2)
            .map(copy);
        },
        async listPendingPayPal(cutoff, limit) {
          return state.orders
            .filter(
              (row) =>
                row.provider === "paypal" &&
                row.orderType === "one_time" &&
                row.status === "pending" &&
                row.createdAt <= cutoff &&
                row.updatedAt <= cutoff,
            )
            .sort((a, b) => a.createdAt - b.createdAt)
            .slice(0, limit)
            .map(copy);
        },
        async touch(orderId, at) {
          const row = state.orders.find((item) => item.id === orderId);
          if (row) row.updatedAt = at;
        },
        async markPendingFailed(provider, captureId, at) {
          for (const row of state.orders) {
            if (
              row.provider === provider &&
              row.status === "pending" &&
              (row.providerOrderId === captureId || row.providerPaymentId === captureId)
            ) {
              row.status = "failed";
              row.updatedAt = at;
            }
          }
        },
      },
      subscriptions: {
        async upsert(row, preserveTerminal) {
          const existing = state.subscriptions.find(
            (item) =>
              item.provider === row.provider &&
              item.providerSubscriptionId === row.providerSubscriptionId,
          );
          if (!existing) {
            state.subscriptions.push({
              ...row,
              id: nextSeq(),
              remainingGrants: 0,
              nextGrantAt: null,
              createdAt: row.updatedAt,
              metadata: row.metadata ?? null,
            });
            return;
          }
          if (preserveTerminal && (existing.status === "canceled" || existing.status === "expired"))
            return;
          const keep = {
            id: existing.id,
            remainingGrants: existing.remainingGrants,
            nextGrantAt: existing.nextGrantAt,
            createdAt: existing.createdAt,
          };
          Object.assign(existing, row, keep, {
            metadata: row.metadata !== undefined ? row.metadata : existing.metadata,
          });
        },
        async findByKey(provider, providerSubscriptionId) {
          const row = state.subscriptions.find(
            (item) =>
              item.provider === provider && item.providerSubscriptionId === providerSubscriptionId,
          );
          return row ? copy(row) : null;
        },
        async lockByKey(provider, providerSubscriptionId) {
          return this.findByKey(provider, providerSubscriptionId);
        },
        async findByLocalId(localId) {
          const row = state.subscriptions.find((item) => item.id === localId);
          return row ? copy(row) : null;
        },
        async lockByLocalId(localId) {
          return this.findByLocalId(localId);
        },
        async update(provider, providerSubscriptionId, patch) {
          const row = state.subscriptions.find(
            (item) =>
              item.provider === provider && item.providerSubscriptionId === providerSubscriptionId,
          );
          if (!row) throw new Error("missing subscription");
          Object.assign(row, patch);
        },
        async advisoryLockSubject() {},
        async listBySubject(subject) {
          const rows = subject.organizationId
            ? orgRows(subject.organizationId)
            : subject.userId
              ? personal(subject.userId)
              : [];
          return rows.map(copy);
        },
        async listDueDrips(now, subject, limit) {
          let rows = state.subscriptions.filter(
            (row) =>
              row.remainingGrants > 0 &&
              row.nextGrantAt &&
              row.nextGrantAt <= now &&
              (row.status === "active" || row.status === "trialing"),
          );
          if (subject?.organizationId)
            rows = rows.filter((row) => row.organizationId === subject.organizationId);
          else if (subject?.userId)
            rows = rows.filter(
              (row) => row.userId === subject.userId && row.organizationId == null,
            );
          rows.sort((a, b) => a.nextGrantAt - b.nextGrantAt);
          return (limit ? rows.slice(0, limit) : rows).map((row) => ({ id: row.id }));
        },
        async listOverdueRenewals(providers, cutoff, limit) {
          return state.subscriptions
            .filter(
              (row) =>
                providers.includes(row.provider) &&
                row.currentPeriodEnd &&
                row.currentPeriodEnd <= cutoff &&
                row.updatedAt <= cutoff &&
                ["active", "trialing", "past_due"].includes(row.status),
            )
            .sort((a, b) => a.currentPeriodEnd - b.currentPeriodEnd)
            .slice(0, limit)
            .map(copy);
        },
        async touch(localId, at) {
          const row = state.subscriptions.find((item) => item.id === localId);
          if (row) row.updatedAt = at;
        },
        async hasEntitledForUser(userId, entitled) {
          const orgIds = new Set(
            state.members
              .filter((member) => member.userId === userId)
              .map((member) => member.organizationId),
          );
          return state.subscriptions.some(
            (row) =>
              entitled.includes(row.status) &&
              ((row.userId === userId && row.organizationId == null) ||
                (row.organizationId && orgIds.has(row.organizationId))),
          );
        },
        async findLatestEntitled(subject, entitled) {
          const rows = (
            subject.organizationId ? orgRows(subject.organizationId) : personal(subject.userId)
          ).filter((row) => entitled.includes(row.status));
          rows.sort((a, b) => b.createdAt - a.createdAt);
          return rows[0] ? copy(rows[0]) : null;
        },
        async hasOtherLive(subject, exceptId, entitled) {
          const rows = subject.organizationId
            ? orgRows(subject.organizationId)
            : personal(subject.userId);
          return rows.some((row) => row.id !== exceptId && entitled.includes(row.status));
        },
        async countOtherSubscriptionOrders(
          provider,
          providerSubscriptionId,
          exceptProviderOrderId,
        ) {
          return state.orders.filter(
            (row) =>
              row.provider === provider &&
              row.providerSubscriptionId === providerSubscriptionId &&
              ["subscription_initial", "subscription_renewal"].includes(row.orderType) &&
              row.providerOrderId !== exceptProviderOrderId,
          ).length;
        },
      },
      billing: {
        async userHasLiveSubscription(userId, entitled) {
          return state.subscriptions.some(
            (row) => row.userId === userId && entitled.includes(row.status),
          );
        },
        async findLiveOrganizationPlan(organizationId, entitled) {
          const rows = orgRows(organizationId)
            .filter((row) => entitled.includes(row.status))
            .sort((a, b) => b.createdAt - a.createdAt);
          return rows[0] ? { planId: rows[0].planId, status: rows[0].status } : null;
        },
        async organizationHasBillingHistory(organizationId) {
          return (
            orgRows(organizationId).length > 0 ||
            state.ledger.some((row) => row.organizationId === organizationId)
          );
        },
      },
      identity: {
        async findLivingUserId(userId) {
          return state.users[userId] ? userId : null;
        },
        async findLivingOrganizationId(organizationId) {
          return state.orgs[organizationId] ? organizationId : null;
        },
        async isLiveMember(userId, organizationId) {
          return state.members.some(
            (member) => member.userId === userId && member.organizationId === organizationId,
          );
        },
        async findUserIdByProviderCustomer(provider, customerId) {
          const field =
            provider === "stripe"
              ? "stripeCustomerId"
              : provider === "creem"
                ? "creemCustomerId"
                : "paypalPayerId";
          const found = Object.entries(state.users).find(([, user]) => user[field] === customerId);
          return found ? found[0] : null;
        },
        async readProviderCustomer(userId, provider) {
          const user = state.users[userId];
          if (!user) return null;
          return provider === "stripe"
            ? user.stripeCustomerId
            : provider === "creem"
              ? user.creemCustomerId
              : user.paypalPayerId;
        },
        async writeProviderCustomerIfAbsent(userId, provider, customerId) {
          const user = state.users[userId];
          if (!user) return "missing";
          const field =
            provider === "stripe"
              ? "stripeCustomerId"
              : provider === "creem"
                ? "creemCustomerId"
                : "paypalPayerId";
          if (user[field] === customerId) return "same";
          if (user[field]) return "conflict";
          user[field] = customerId;
          return "written";
        },
        async findUserEmail(userId) {
          return state.users[userId]?.email ?? null;
        },
      },
    };
  }

  return {
    async transaction(run, outer) {
      if (outer) {
        if (outer !== current)
          throw new Error("Commerce transaction does not belong to this instance");
        return run(outer);
      }
      if (active.getStore()) {
        throw new Error(
          "Refusing to open another commerce transaction while one is active; use commerce.join(unit)",
        );
      }
      const job = queue.then(async () => {
        const saved = snapshot();
        const openUnit = unit();
        current = openUnit;
        try {
          return await active.run(openUnit, () => run(openUnit));
        } catch (error) {
          restore(saved);
          throw error;
        } finally {
          current = null;
        }
      });
      queue = job.then(
        () => {},
        () => {},
      );
      return job;
    },
    seedUser(userId, extra = {}) {
      state.users[userId] = {
        email: extra.email ?? `${userId}@example.invalid`,
        stripeCustomerId: extra.stripeCustomerId ?? null,
        creemCustomerId: extra.creemCustomerId ?? null,
        paypalPayerId: extra.paypalPayerId ?? null,
      };
    },
    seedOrg(organizationId) {
      state.orgs[organizationId] = { id: organizationId };
    },
    seedMember(userId, organizationId) {
      state.members.push({ userId, organizationId });
    },
    failNextBalanceWrite() {
      failBalanceWrites += 1;
    },
    orders() {
      return state.orders.map(copy);
    },
    balance(subject) {
      return { ...(state.balances[keyOf(subject)] ?? { subscription: 0, purchased: 0 }) };
    },
    async setBalance(subject, next) {
      state.balances[keyOf(subject)] = { ...next };
    },
    async patchOrder(providerOrderId, patch) {
      const row = state.orders.find((item) => item.providerOrderId === providerOrderId);
      Object.assign(row, patch);
    },
  };
}

const plans = [
  {
    id: "pack",
    provider: "stripe",
    kind: "credit_pack",
    credits: 100,
    stripePriceId: { test: "price_pack", live: "price_pack_live" },
  },
  {
    id: "paypal-pack",
    provider: "paypal",
    kind: "credit_pack",
    credits: 100,
    paypalPlanId: { test: "paypal-pack", live: "paypal-pack-live" },
  },
  {
    id: "creem-pack",
    provider: "creem",
    kind: "credit_pack",
    credits: 100,
    creemProductId: { test: "prod_pack", live: "prod_pack_live" },
  },
  {
    id: "yearly",
    provider: "stripe",
    kind: "subscription",
    interval: "year",
    monthlyCredits: 10,
    stripePriceId: { test: "price_year", live: "price_year_live" },
  },
  {
    id: "monthly",
    provider: "stripe",
    kind: "subscription",
    interval: "month",
    monthlyCredits: 100,
    stripePriceId: { test: "price_month", live: "price_month_live" },
  },
  {
    id: "team",
    provider: "stripe",
    kind: "subscription",
    interval: "month",
    monthlyCredits: 20,
    stripePriceId: { test: "price_team", live: "price_team_live" },
  },
  {
    id: "creem-monthly",
    provider: "creem",
    kind: "subscription",
    interval: "month",
    monthlyCredits: 40,
    creemProductId: { test: "prod_creem_month", live: "prod_creem_month_live" },
  },
  {
    id: "paypal-monthly",
    provider: "paypal",
    kind: "subscription",
    interval: "month",
    monthlyCredits: 30,
    paypalPlanId: { test: "P-MONTH", live: "P-MONTH-LIVE" },
  },
];

const CREEM_SECRET = "creem-whsec-test";
const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
let creemWebhooksPromise;
function loadCreemWebhooks() {
  creemWebhooksPromise ??= import(pathToFileURL(appRequire.resolve("creem/webhooks")).href);
  return creemWebhooksPromise;
}
function creemHeaders(raw, secret = CREEM_SECRET) {
  return new Headers({ "creem-signature": createHmac("sha256", secret).update(raw).digest("hex") });
}
function creemStamp() {
  const now = Date.now();
  return { now, iso: new Date(now).toISOString() };
}
function creemProduct(id, billingType, billingPeriod) {
  const { iso } = creemStamp();
  return {
    id,
    mode: "test",
    object: "product",
    name: id,
    description: id,
    price: 1000,
    currency: "USD",
    billing_type: billingType,
    billing_period: billingPeriod,
    status: "active",
    tax_mode: "exclusive",
    tax_category: "saas",
    created_at: iso,
    updated_at: iso,
  };
}
function creemCustomer(id) {
  const { iso } = creemStamp();
  return {
    id,
    mode: "test",
    object: "customer",
    email: "buyer@example.invalid",
    country: "US",
    created_at: iso,
    updated_at: iso,
  };
}
function creemEvent(eventType, object) {
  return JSON.stringify({ id: `evt-${eventType}`, eventType, created_at: Date.now(), object });
}

function harness(options = {}) {
  const store = options.store ?? createMemoryStore();
  let now = options.now ?? new Date(2026, 0, 31, 12, 0, 0);
  const scheduled = [];
  const logs = [];
  const notices = [];
  const alerts = [];
  let principal = options.principal ?? null;
  let purchasesEnabled = options.purchasesEnabled ?? true;
  const catalog = buildSourceIdentityCatalog(plans);
  const commerce = createCommerce({
    productId: options.productId ?? "commerce-test",
    catalog,
    clock: { now: () => new Date(now.getTime()) },
    identity: {
      async getFreshPrincipal() {
        return principal;
      },
      async isLiveMember(userId, organizationId) {
        return store.transaction((unit) => unit.identity.isLiveMember(userId, organizationId));
      },
    },
    store,
    logger: {
      warn(data, message) {
        logs.push({ level: "warn", data, message });
      },
      error(data, message) {
        logs.push({ level: "error", data, message });
      },
    },
    schedulePostCommit(task) {
      scheduled.push(task);
    },
    notifier: {
      async onOrderCommitted(notice) {
        notices.push(notice);
      },
      async onCreditGrantFailed(notice) {
        alerts.push(notice);
      },
      async onPaymentDenied(notice) {
        notices.push(notice);
      },
      async onDispute(notice) {
        notices.push(notice);
      },
    },
    purchasesEnabled,
    cancelSubscription: options.cancelSubscription,
    dedupe: options.dedupe,
  });
  return {
    store,
    commerce,
    logs,
    notices,
    alerts,
    scheduled,
    catalog,
    setNow(value) {
      now = value;
    },
    now: () => now,
    setPrincipal(value) {
      principal = value;
    },
    setPurchasesEnabled(value) {
      purchasesEnabled = value;
      commerce.runtime.deps.purchasesEnabled = value;
    },
    async flush() {
      const tasks = scheduled.splice(0, scheduled.length);
      for (const task of tasks) await task();
    },
  };
}

function oneTime(userId, providerOrderId, extra = {}) {
  return {
    provider: "stripe",
    providerOrderId,
    subject: { userId, organizationId: null },
    planId: "pack",
    credits: 100,
    amountTotal: 1000,
    currency: "usd",
    ...extra,
  };
}

test("manifest is explicit ESM and provider SDKs stay optional peers", async () => {
  const manifest = JSON.parse(await readFile(join(pkgRoot, "package.json"), "utf8"));
  assert.equal(manifest.name, "@sunpcm/niu-commerce");
  assert.equal(manifest.version, "0.1.0-next.0");
  assert.equal(manifest.type, "module");
  assert.equal(manifest.publishConfig.registry, "https://npm.pkg.github.com");
  assert.equal(manifest.publishConfig.access, "restricted");
  assert.equal(manifest.license, "UNLICENSED");
  assert.deepEqual(manifest.dependencies, undefined);
  assert.equal(manifest.peerDependenciesMeta.stripe.optional, true);
  assert.equal(manifest.peerDependenciesMeta.creem.optional, true);
  assert.equal(manifest.exports["."].default, "./dist/index.js");
  assert.ok(manifest.exports["./providers/stripe"]);
  assert.ok(manifest.files.includes("NOTICE"));
});

test("core root JS and d.ts do not import Next, SQL, or an unselected provider SDK", async () => {
  const forbidden =
    /(?:from\s+|import\s*\(|import\s+)["'](?:next|react|drizzle-orm|postgres|stripe|creem|@\/)/;
  for (const file of await readdir(join(pkgRoot, "dist"))) {
    if (!file.endsWith(".js") && !file.endsWith(".d.ts")) continue;
    if (file === "providers") continue;
    const src = await readFile(join(pkgRoot, "dist", file), "utf8");
    assert.doesNotMatch(src, forbidden, file);
  }
  const stripeTypes = await readFile(join(pkgRoot, "dist", "providers", "stripe.d.ts"), "utf8");
  assert.doesNotMatch(stripeTypes, /from ["']stripe["']/);
});

test("nine invalid spend amounts write nothing", async () => {
  const env = harness();
  const userId = id();
  env.store.seedUser(userId);
  await env.commerce.grantPurchasedCredits({ userId, amount: 50, note: "seed" });
  const before = env.store.balance({ userId });
  const ledgerBefore = env.store.orders().length;
  const invalid = [
    -5,
    0,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1.5,
    2147483648,
    -2147483649,
    Number.MAX_SAFE_INTEGER + 1,
  ];
  assert.equal(invalid.length, 9);
  for (const amount of invalid) {
    await assert.rejects(
      () => env.commerce.spendCredits({ userId, amount, note: "bad" }),
      /safe integer|non-negative|non-zero|PostgreSQL integer range/,
    );
  }
  assert.deepEqual(env.store.balance({ userId }), before);
  assert.equal(env.store.orders().length, ledgerBefore);
});

test("pools stay separate, signup bonus is once, and concurrent spend cannot go negative", async () => {
  const env = harness();
  const userId = id();
  const otherId = id();
  const organizationId = id();
  env.store.seedUser(userId);
  env.store.seedUser(otherId);
  env.store.seedOrg(organizationId);
  env.store.seedMember(userId, organizationId);
  await Promise.all(
    Array.from({ length: 6 }, () =>
      env.commerce.grantSignupBonusCredits({ userId, amount: 30, note: "welcome" }),
    ),
  );
  assert.equal(env.store.balance({ userId }).purchased, 30);
  await env.commerce.grantPurchasedCredits({ userId, organizationId, amount: 100, note: "team" });
  await env.commerce.spendCredits({ userId, organizationId, amount: 3, note: "team spend" });
  assert.equal(env.store.balance({ organizationId }).purchased, 97);
  assert.equal(env.store.balance({ userId }).purchased, 30);
  assert.equal(env.store.balance({ userId: otherId }).purchased, 0);
  const outcomes = await Promise.allSettled(
    Array.from({ length: 20 }, () =>
      env.commerce.spendCredits({ userId, amount: 3, note: "spend" }),
    ),
  );
  const ok = outcomes.filter((result) => result.status === "fulfilled").length;
  const insufficient = outcomes.filter(
    (result) => result.status === "rejected" && result.reason instanceof InsufficientCreditsError,
  ).length;
  assert.equal(ok, 10);
  assert.equal(insufficient, 10);
  assert.equal(env.store.balance({ userId }).purchased, 0);
});

test("usage refund returns the original buckets and replays once", async () => {
  const env = harness();
  const userId = id();
  env.store.seedUser(userId);
  await env.commerce.resetSubscriptionCredits({ userId, amount: 10, note: "grant" });
  await env.commerce.grantPurchasedCredits({ userId, amount: 5, note: "pack" });
  const spent = await env.commerce.spendCredits({ userId, amount: 12, note: "task" });
  assert.equal(spent.spentFromSubscription, 10);
  assert.equal(spent.spentFromPurchased, 2);
  await env.commerce.refundSpentCredits({ userId, spendTxId: spent.txId, note: "failed task" });
  await env.commerce.refundSpentCredits({ userId, spendTxId: spent.txId, note: "replay" });
  assert.deepEqual(env.store.balance({ userId }), { subscription: 10, purchased: 5 });
});

test("credit write failure rolls back the order and replay grants once", async () => {
  const env = harness();
  const userId = id();
  const providerOrderId = `atom-${id()}`;
  env.store.seedUser(userId);
  env.store.failNextBalanceWrite();
  await assert.rejects(
    () => env.commerce.fulfillOneTimePurchase(oneTime(userId, providerOrderId)),
    /credit write blocked/,
  );
  assert.equal(env.store.orders().length, 0);
  assert.equal(env.store.balance({ userId }).purchased, 0);
  assert.equal(env.scheduled.length, 0);
  const created = await env.commerce.fulfillOneTimePurchase(oneTime(userId, providerOrderId));
  const replay = await env.commerce.fulfillOneTimePurchase(oneTime(userId, providerOrderId));
  assert.equal(created.created, true);
  assert.equal(replay.created, false);
  assert.equal(env.store.balance({ userId }).purchased, 100);
  assert.equal(env.scheduled.length, 1);
  await env.flush();
  assert.equal(env.notices.length, 1);
});

test("historical unknown refund id is refused and an official cumulative total recovers only that order", async () => {
  const env = harness();
  const userId = id();
  const bystander = id();
  const historicalId = `old-${id()}`;
  env.store.seedUser(userId);
  env.store.seedUser(bystander);
  await env.commerce.fulfillOneTimePurchase(oneTime(userId, historicalId));
  await env.commerce.resetSubscriptionCredits({ userId, amount: 40, note: "other balance" });
  await env.store.patchOrder(historicalId, { amountRefunded: 400, status: "partially_refunded" });
  await env.store.setBalance({ userId }, { subscription: 40, purchased: 60 });
  await env.commerce.fulfillOneTimePurchase(oneTime(bystander, `by-${id()}`));
  const reject = (refundId, amount) =>
    assert.rejects(
      () =>
        env.commerce.applyRefund({
          provider: "stripe",
          providerOrderId: historicalId,
          amountRefunded: amount,
          cumulative: false,
          refundId,
        }),
      RefundHistoryIncompleteError,
    );
  await reject("same-amount-unknown", 400);
  await reject("other-amount-unknown", 100);
  assert.equal(
    env.store.orders().find((row) => row.providerOrderId === historicalId).amountRefunded,
    400,
  );
  assert.deepEqual(env.store.balance({ userId }), { subscription: 40, purchased: 60 });
  await env.commerce.applyRefund({
    provider: "stripe",
    providerOrderId: historicalId,
    amountRefunded: 700,
    cumulative: true,
    refundId: "official-700",
  });
  await env.commerce.applyRefund({
    provider: "stripe",
    providerOrderId: historicalId,
    amountRefunded: 400,
    cumulative: true,
    refundId: "stale-official",
  });
  assert.equal(
    env.store.orders().find((row) => row.providerOrderId === historicalId).amountRefunded,
    700,
  );
  assert.deepEqual(env.store.balance({ userId }), { subscription: 40, purchased: 30 });
  await env.commerce.applyRefund({
    provider: "stripe",
    providerOrderId: historicalId,
    amountRefunded: 1000,
    cumulative: true,
    refundId: "official-1000",
  });
  assert.equal(env.store.balance({ userId }).purchased, 0);
  assert.equal(env.store.balance({ userId }).subscription, 40);
  assert.equal(env.store.balance({ userId: bystander }).purchased, 100);
});

test("creem event refunds sum by id in either order", async () => {
  const env = harness();
  const userId = id();
  env.store.seedUser(userId);
  const webhooks = await loadCreemWebhooks();
  const provider = await createCreemProvider({
    commerce: env.commerce,
    webhookSecret: CREEM_SECRET,
    webhooks,
  });
  const orderId = `creem-${id()}`;
  await env.commerce.fulfillOneTimePurchase({
    ...oneTime(userId, orderId),
    provider: "creem",
    planId: "creem-pack",
  });
  const event = (refundId, amount) => {
    const { now } = creemStamp();
    return creemEvent("refund.created", {
      id: refundId,
      mode: "test",
      object: "refund",
      status: "succeeded",
      refund_amount: amount,
      refund_currency: "USD",
      reason: "requested_by_customer",
      created_at: now,
      order: orderId,
      transaction: {
        id: `tran-${orderId}`,
        mode: "test",
        object: "transaction",
        amount,
        currency: "USD",
        type: "payment",
        status: "paid",
        created_at: now,
        order: orderId,
      },
    });
  };
  const send = (raw) => provider.webhook()(raw, creemHeaders(raw));
  assert.equal((await send(event("b", 200))).status, 200);
  assert.equal((await send(event("a", 300))).status, 200);
  assert.equal((await send(event("a", 300))).status, 200);
  assert.equal(
    env.store.orders().find((row) => row.providerOrderId === orderId).amountRefunded,
    500,
  );
  assert.equal(env.store.balance({ userId }).purchased, 50);
  const before = env.store.orders().length;
  assert.equal(
    (await provider.webhook()(event("b", 200), new Headers({ "creem-signature": "deadbeef" })))
      .status,
    400,
  );
  assert.equal(
    env.store.orders().find((row) => row.providerOrderId === orderId).amountRefunded,
    500,
  );
  assert.equal(env.store.orders().length, before);
});

test("creem checkout uses the persisted customer owner and rejects conflicting metadata", async () => {
  const webhooks = {
    async verifyWebhookSignature() {},
    parseWebhookEvent() {
      throw new Error("not used");
    },
    parseWebhookEventEntity() {
      throw new Error("not used");
    },
  };

  {
    const env = harness();
    const owner = id();
    env.store.seedUser(owner, { creemCustomerId: "creem-owner" });
    const provider = await createCreemProvider({
      commerce: env.commerce,
      webhookSecret: CREEM_SECRET,
      webhooks,
    });
    await provider.fulfillCheckout({
      id: `checkout-${id()}`,
      status: "completed",
      metadata: { planId: "creem-pack" },
      product: "prod_pack",
      customer: "creem-owner",
      order: {
        id: `order-${id()}`,
        type: "onetime",
        product: "prod_pack",
        transaction: `txn-${id()}`,
        amount: 1000,
        amountPaid: 1000,
        currency: "USD",
      },
    });
    assert.equal(env.store.balance({ userId: owner }).purchased, 100);
  }

  {
    const env = harness();
    const owner = id();
    const other = id();
    env.store.seedUser(owner, { creemCustomerId: "creem-owner" });
    env.store.seedUser(other);
    const provider = await createCreemProvider({
      commerce: env.commerce,
      webhookSecret: CREEM_SECRET,
      webhooks,
    });
    await assert.rejects(
      () =>
        provider.fulfillCheckout({
          id: `checkout-${id()}`,
          status: "completed",
          metadata: { userId: other, planId: "creem-pack" },
          product: "prod_pack",
          customer: "creem-owner",
          order: {
            id: `order-${id()}`,
            type: "onetime",
            product: "prod_pack",
            transaction: `txn-${id()}`,
            amount: 1000,
            amountPaid: 1000,
            currency: "USD",
          },
        }),
      /ownership conflict/,
    );
    assert.equal(env.store.orders().length, 0);
    assert.equal(env.store.balance({ userId: owner }).purchased, 0);
    assert.equal(env.store.balance({ userId: other }).purchased, 0);
  }
});

test("terminal subscription is not resurrected and a late renewal grants nothing", async () => {
  const env = harness();
  const userId = id();
  const providerSubscriptionId = `sub-${id()}`;
  env.store.seedUser(userId);
  await env.commerce.syncSubscription({
    provider: "stripe",
    providerSubscriptionId,
    subject: { userId, organizationId: null },
    planId: "monthly",
    status: "canceled",
    interval: "month",
    monthlyCredits: 100,
  });
  await env.commerce.syncSubscription({
    provider: "stripe",
    providerSubscriptionId,
    subject: { userId, organizationId: null },
    planId: "monthly",
    status: "active",
    interval: "month",
    monthlyCredits: 100,
  });
  const renewed = await env.commerce.fulfillSubscriptionPayment({
    subscription: {
      provider: "stripe",
      providerSubscriptionId,
      subject: { userId, organizationId: null },
      planId: "monthly",
      status: "active",
      interval: "month",
      monthlyCredits: 100,
    },
    orderType: "subscription_renewal",
    providerOrderId: `in-${id()}`,
    amountTotal: 1000,
    currency: "usd",
  });
  assert.equal(renewed.created, true);
  assert.equal(env.store.balance({ userId }).subscription, 0);
  const row = await env.store.transaction((unit) =>
    unit.subscriptions.findByKey("stripe", providerSubscriptionId),
  );
  assert.equal(row.status, "canceled");
});

test("yearly drip collapses overdue months into one reset and a replay does not reopen the year", async () => {
  const env = harness();
  const userId = id();
  const providerSubscriptionId = `year-${id()}`;
  env.store.seedUser(userId);
  const started = env.now();
  await env.commerce.fulfillSubscriptionPayment({
    subscription: {
      provider: "stripe",
      providerSubscriptionId,
      subject: { userId, organizationId: null },
      planId: "yearly",
      status: "active",
      interval: "year",
      monthlyCredits: 10,
      currentPeriodStart: started,
    },
    orderType: "subscription_initial",
    providerOrderId: `year-inv-${id()}`,
    amountTotal: 12000,
    currency: "usd",
    periodStart: started,
  });
  assert.equal(env.store.balance({ userId }).subscription, 10);
  env.setNow(new Date(2027, 0, 31, 12, 0, 0));
  await env.commerce.settleDueDripGrants({ userId });
  await env.commerce.settleDueDripGrants({ userId });
  assert.equal(env.store.balance({ userId }).subscription, 10);
  const done = await env.store.transaction((unit) =>
    unit.subscriptions.findByKey("stripe", providerSubscriptionId),
  );
  assert.equal(done.remainingGrants, 0);
  assert.equal(done.nextGrantAt, null);
  const replay = await env.commerce.fulfillSubscriptionPayment({
    subscription: {
      provider: "stripe",
      providerSubscriptionId,
      subject: { userId, organizationId: null },
      planId: "yearly",
      status: "active",
      interval: "year",
      monthlyCredits: 10,
      currentPeriodStart: started,
    },
    orderType: "subscription_initial",
    providerOrderId: env.store.orders()[0].providerOrderId,
    amountTotal: 12000,
    currency: "usd",
    periodStart: started,
  });
  assert.equal(replay.created, false);
  assert.equal(
    (
      await env.store.transaction((unit) =>
        unit.subscriptions.findByKey("stripe", providerSubscriptionId),
      )
    ).remainingGrants,
    0,
  );
});

test("unbound drip settlement commits one subscription before the next one starts", async () => {
  const env = harness();
  const userId = id();
  env.store.seedUser(userId);
  const started = env.now();
  const dueAt = new Date(2026, 1, 28, 12, 0, 0);
  const seed = async (providerSubscriptionId) => {
    await env.commerce.syncSubscription({
      provider: "stripe",
      providerSubscriptionId,
      subject: { userId, organizationId: null },
      planId: "yearly",
      status: "active",
      interval: "year",
      monthlyCredits: 10,
      currentPeriodStart: started,
    });
    await env.store.transaction(async (unit) => {
      await unit.subscriptions.update("stripe", providerSubscriptionId, {
        remainingGrants: 11,
        nextGrantAt: dueAt,
        updatedAt: started,
      });
    });
  };
  await seed(`drip-a-${id()}`);
  await seed(`drip-b-${id()}`);
  env.setNow(dueAt);
  let opened = 0;
  const original = env.store.transaction;
  env.store.transaction = async function (run, outer) {
    if (!outer) opened += 1;
    if (!outer && opened === 3) throw new Error("second drip blocked");
    return original.call(env.store, run, outer);
  };
  await assert.rejects(() => env.commerce.settleDueDripGrants({ userId }), /second drip blocked/);
  const rows = await original.call(env.store, (unit) =>
    unit.subscriptions.listBySubject({ userId }),
  );
  assert.equal(rows.filter((row) => row.remainingGrants === 10).length, 1);
  assert.equal(rows.filter((row) => row.remainingGrants === 11).length, 1);
  assert.equal(env.store.balance({ userId }).subscription, 10);
});

test("overdue renewal pages skip a failed row and a successful replay grants once", async () => {
  const env = harness();
  const userId = id();
  const otherId = id();
  const first = `renew-${id()}`;
  const second = `renew-${id()}`;
  env.store.seedUser(userId);
  env.store.seedUser(otherId);
  const periodEnd = env.now();
  const make = (providerSubscriptionId, subjectId) =>
    env.commerce.fulfillSubscriptionPayment({
      subscription: {
        provider: "stripe",
        providerSubscriptionId,
        subject: { userId: subjectId, organizationId: null },
        planId: "monthly",
        status: "active",
        interval: "month",
        monthlyCredits: 100,
        currentPeriodStart: new Date(2025, 11, 31, 12, 0, 0),
        currentPeriodEnd: periodEnd,
      },
      orderType: "subscription_initial",
      providerOrderId: `seed-${providerSubscriptionId}`,
      amountTotal: 1000,
      currency: "usd",
    });
  await make(first, userId);
  await make(second, otherId);
  env.setNow(new Date(2026, 1, 2, 12, 0, 0));
  let calls = 0;
  const failed = await env.commerce.reconcileOverdueRenewals(1, {
    stripe: async () => {
      calls += 1;
      throw new Error("provider down");
    },
  });
  assert.equal(failed.failed, 1);
  assert.equal(calls, 1);
  const skipped = await env.commerce.reconcileOverdueRenewals(10, {
    stripe: async () => {
      calls += 1;
      return "fulfilled";
    },
  });
  assert.equal(skipped.overdue, 1);
  const again = await env.commerce.reconcileOverdueRenewals(10, {
    stripe: async (row) => {
      await env.commerce.fulfillSubscriptionPayment({
        subscription: {
          provider: "stripe",
          providerSubscriptionId: row.providerSubscriptionId,
          subject: { userId: row.userId, organizationId: null },
          planId: "monthly",
          status: "active",
          interval: "month",
          monthlyCredits: 100,
          currentPeriodStart: env.now(),
          currentPeriodEnd: new Date(2026, 2, 2, 12, 0, 0),
        },
        orderType: "subscription_renewal",
        providerOrderId: `page-${row.providerSubscriptionId}`,
        amountTotal: 1000,
        currency: "usd",
        periodStart: env.now(),
      });
      return "fulfilled";
    },
  });
  assert.equal(again.fulfilled, 1);
  assert.equal(env.store.balance({ userId }).subscription, 100);
  const replay = await env.commerce.reconcileOverdueRenewals(10, {
    stripe: async () => {
      throw new Error("should not run");
    },
  });
  assert.equal(replay.overdue, 0);
});

test("fresh capture and closed purchases do not block a historical webhook or refund", async () => {
  const env = harness();
  const userId = id();
  const organizationId = id();
  const orderId = `pp-${id()}`;
  env.store.seedUser(userId);
  env.store.seedOrg(organizationId);
  env.store.seedMember(userId, organizationId);
  env.setPrincipal({ userId, banned: false, revoked: false });
  await env.commerce.recordPayPalSourceBinding({
    orderId,
    userId,
    organizationId,
    planId: "paypal-pack",
    amountTotal: 1000,
    currency: "usd",
  });
  env.setPurchasesEnabled(false);
  env.setPrincipal({ userId, banned: true, revoked: true });
  await assert.rejects(
    () => env.commerce.authorizeInteractiveCapture({ organizationId }),
    PermanentFulfillmentError,
  );
  await assert.rejects(
    () =>
      env.commerce.recordPayPalSourceBinding({
        orderId: `new-${id()}`,
        userId,
        organizationId,
        planId: "paypal-pack",
        amountTotal: 1000,
        currency: "usd",
      }),
    /closed|Interactive/,
  );
  const provider = createPayPalProvider({
    webhookId: "WH-test",
    commerce: env.commerce,
    transport: {
      async verifySignature() {
        return { status: 200, verificationStatus: "SUCCESS" };
      },
    },
  });
  const headers = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://example.invalid/cert",
    "paypal-transmission-id": id(),
    "paypal-transmission-sig": "sig",
    "paypal-transmission-time": "now",
  };
  const body = JSON.stringify({
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: `cap-${id()}`,
      status: "COMPLETED",
      custom_id: `${userId}|paypal-pack||${organizationId}`,
      amount: { value: "10.00", currency_code: "USD" },
      supplementary_data: { related_ids: { order_id: orderId } },
    },
  });
  assert.equal((await provider.webhook()(body, headers)).status, 200);
  assert.equal((await provider.webhook()(body, headers)).status, 200);
  assert.equal(env.store.balance({ organizationId }).purchased, 100);
  assert.equal(env.store.balance({ userId }).purchased, 0);
  assert.equal(env.store.orders().filter((row) => row.providerOrderId === orderId).length, 1);
});

test("pending PayPal binding conflicts write nothing and a mismatched custom id does not grant", async () => {
  const env = harness();
  const userId = id();
  const organizationId = id();
  const orderId = `bind-${id()}`;
  env.store.seedUser(userId);
  env.store.seedOrg(organizationId);
  await env.commerce.recordPayPalSourceBinding({
    orderId,
    userId,
    organizationId,
    planId: "paypal-pack",
    amountTotal: 1000,
    currency: "usd",
  });
  await assert.rejects(
    () =>
      env.commerce.recordPayPalSourceBinding({
        orderId,
        userId,
        organizationId,
        planId: "paypal-pack",
        amountTotal: 500,
        currency: "usd",
      }),
    /conflict/,
  );
  assert.equal(env.store.orders()[0].amountTotal, 1000);
  await assert.rejects(
    () =>
      env.commerce.boundPayPalCapture({
        captureId: "cap-foreign",
        customId: `${userId}|paypal-pack||${id()}`,
        sourceOrderId: orderId,
        amountValue: "10.00",
        currencyCode: "USD",
      }),
    /binding conflict/,
  );
  assert.equal(env.store.balance({ organizationId }).purchased, 0);
});

test("billing reads share the caller transaction and do not treat membership as a purchaser subscription", async () => {
  const env = harness();
  const purchaser = id();
  const member = id();
  const organizationId = id();
  env.store.seedUser(purchaser);
  env.store.seedUser(member);
  env.store.seedOrg(organizationId);
  env.store.seedMember(member, organizationId);
  await assert.rejects(
    env.store.transaction(async (unit) => {
      await unit.subscriptions.upsert(
        {
          userId: purchaser,
          organizationId,
          planId: "team",
          provider: "stripe",
          providerSubscriptionId: `team-${id()}`,
          providerCustomerId: null,
          providerPriceId: null,
          status: "active",
          interval: "month",
          currentPeriodStart: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          canceledAt: null,
          endedAt: null,
          monthlyCredits: 20,
          updatedAt: env.now(),
        },
        false,
      );
      const reads = commerceBillingReads(unit, ENTITLED);
      assert.equal(await reads.userHasLiveSubscription(purchaser), true);
      assert.equal(await reads.userHasLiveSubscription(member), false);
      const seat = await reads.liveOrganizationSeat(organizationId, (planId) =>
        planId === "team" ? 5 : 1,
      );
      assert.deepEqual(seat, { planId: "team", seats: 5, hasTeamSubscription: true });
      assert.equal(await reads.organizationHasBillingHistory(organizationId), true);
      throw new Error("rollback billing seed");
    }),
    /rollback billing seed/,
  );
  await env.store.transaction(async (unit) => {
    const reads = commerceBillingReads(unit, ENTITLED);
    assert.equal(await reads.userHasLiveSubscription(purchaser), false);
    assert.equal(await reads.organizationHasBillingHistory(organizationId), false);
    const seat = await reads.liveOrganizationSeat(organizationId, () => 1);
    assert.deepEqual(seat, { planId: null, seats: 1, hasTeamSubscription: false });
  });
  await env.commerce.syncSubscription({
    provider: "stripe",
    providerSubscriptionId: `live-${id()}`,
    subject: { userId: purchaser, organizationId },
    planId: "team",
    status: "active",
    interval: "month",
    monthlyCredits: 20,
  });
  assert.equal(await env.commerce.hasEntitledSubscription(member), true);
  await env.store.transaction(async (unit) => {
    assert.equal(await commerceBillingReads(unit).userHasLiveSubscription(member), false);
    assert.equal(await commerceBillingReads(unit).userHasLiveSubscription(purchaser), true);
  });
});

test("two commerce instances do not share catalog, clock, store, or post-commit work", async () => {
  const left = harness({ productId: "left" });
  const right = harness({ productId: "right", now: new Date(2026, 5, 1, 12, 0, 0) });
  const userId = id();
  left.store.seedUser(userId);
  right.store.seedUser(userId);
  await left.commerce.grantPurchasedCredits({ userId, amount: 7, note: "left" });
  assert.equal(left.store.balance({ userId }).purchased, 7);
  assert.equal(right.store.balance({ userId }).purchased, 0);
  assert.equal(left.scheduled.length, 0);
  assert.equal(right.scheduled.length, 0);
  let foreign;
  await left.commerce.runtime.withUnit(undefined, async (unit) => {
    foreign = unit;
  });
  await assert.rejects(
    () => right.commerce.runtime.withUnit(foreign, async () => 1),
    /does not belong/,
  );
  await assert.rejects(
    () => left.commerce.runtime.withUnit(foreign, async () => 1),
    /does not belong/,
  );
});

test("join spends and refunds on the caller's transaction and flushes only after it commits", async () => {
  const env = harness();
  const userId = id();
  env.store.seedUser(userId);
  await env.commerce.grantPurchasedCredits({ userId, amount: 10, note: "seed" });
  let opened = 0;
  const original = env.store.transaction;
  env.store.transaction = async function (run, outer) {
    if (!outer) opened += 1;
    return original.call(env.store, run, outer);
  };
  let stale = null;
  await assert.rejects(
    env.store.transaction(async (unit) => {
      stale = unit;
      const joined = env.commerce.join(unit);
      assert.equal(opened, 1);
      const spent = await joined.spendCredits({ userId, amount: 4, note: "admit" });
      assert.equal(opened, 1);
      assert.equal(env.store.balance({ userId }).purchased, 6);
      assert.equal(
        (
          await joined.refundSpentCredits({
            userId,
            spendTxId: spent.txId,
            note: "same transaction",
          })
        ).purchased,
        10,
      );
      await joined.fulfillOneTimePurchase(oneTime(userId, `rollback-${id()}`));
      assert.equal(env.scheduled.length, 0);
      assert.equal(env.store.balance({ userId }).purchased, 110);
      throw new Error("rollback task");
    }),
    /rollback task/,
  );
  env.commerce.runtime.discardOuter(stale);
  assert.equal(env.store.balance({ userId }).purchased, 10);
  assert.equal(env.scheduled.length, 0);
  assert.equal(env.store.orders().length, 0);
  await assert.rejects(
    () => env.commerce.join(stale).spendCredits({ userId, amount: 1, note: "closed" }),
    /does not belong/,
  );
  await assert.rejects(
    () =>
      env.store.transaction(async () => {
        await env.commerce.spendCredits({ userId, amount: 1, note: "separate connection" });
      }),
    /use commerce\.join/,
  );
  assert.equal(env.store.balance({ userId }).purchased, 10);
  const other = harness();
  other.store.seedUser(userId);
  let held = null;
  await env.store.transaction(async (unit) => {
    held = unit;
    const before = opened;
    await assert.rejects(
      () => other.commerce.join(unit).spendCredits({ userId, amount: 1, note: "foreign" }),
      /does not belong/,
    );
    await env.commerce.join(unit).fulfillOneTimePurchase(oneTime(userId, `join-${id()}`));
    assert.equal(opened, before);
    assert.equal(env.scheduled.length, 0);
    assert.equal(env.store.balance({ userId }).purchased, 110);
  });
  assert.equal(env.scheduled.length, 0);
  env.commerce.runtime.flushOuter(held);
  assert.equal(env.scheduled.length, 1);
  env.commerce.runtime.flushOuter(held);
  assert.equal(env.scheduled.length, 1);
  await env.flush();
  assert.equal(env.notices.length, 1);
  assert.equal(other.store.balance({ userId }).purchased, 0);
});

test("verified stripe checkout fulfills once; a bad signature and a secret-bearing failure do not", async () => {
  const env = harness();
  const userId = id();
  env.store.seedUser(userId);
  const secret = "whsec_test_secret";
  const stripe = new Stripe("sk_test_123");
  const session = {
    id: `cs_${id().replaceAll("-", "").slice(0, 16)}`,
    object: "checkout.session",
    mode: "payment",
    payment_status: "paid",
    metadata: { userId, planId: "pack" },
    payment_intent: "pi_1",
    amount_total: 1000,
    amount_subtotal: 1000,
    total_details: { amount_discount: 0, amount_tax: 0 },
    currency: "usd",
    line_items: {
      object: "list",
      data: [{ price: { id: "price_pack" }, quantity: 1 }],
      has_more: false,
    },
  };
  const payload = JSON.stringify({
    id: "evt_checkout",
    object: "event",
    type: "checkout.session.completed",
    data: { object: session },
  });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  const provider = await createStripeProvider({
    commerce: env.commerce,
    webhookSecret: secret,
    apiKey: "sk_test_123",
  });
  const webhook = provider.webhook();
  const ignored = JSON.stringify({
    id: "evt_ignore",
    object: "event",
    type: "customer.created",
    data: { object: { id: "cus_1" } },
  });
  assert.equal(
    (await webhook(ignored, stripe.webhooks.generateTestHeaderString({ payload: ignored, secret })))
      .status,
    200,
  );
  assert.equal((await webhook(payload, "t=1,v1=deadbeef")).status, 400);
  assert.equal(env.store.orders().length, 0);
  assert.equal(env.store.balance({ userId }).purchased, 0);
  assert.equal((await webhook(payload, signature)).status, 200);
  assert.equal((await webhook(payload, signature)).status, 200);
  assert.equal(env.store.balance({ userId }).purchased, 100);
  assert.equal(env.store.orders().length, 1);
  const failingSession = {
    ...session,
    id: `cs_${id().replaceAll("-", "").slice(0, 16)}`,
    line_items: undefined,
  };
  const failingPayload = JSON.stringify({
    id: "evt_fail",
    object: "event",
    type: "checkout.session.completed",
    data: { object: failingSession },
  });
  const failing = await createStripeProvider({
    commerce: env.commerce,
    webhookSecret: secret,
    client: {
      webhooks: {
        constructEvent: () => ({
          type: "checkout.session.completed",
          data: { object: failingSession },
        }),
      },
    },
    lineItems: async () => {
      throw new Error("stripe down api_key=sk_live_secret Authorization: Bearer tok");
    },
  });
  const response = await failing.webhook()(failingPayload, signature);
  assert.equal(response.status, 500);
  assert.equal(response.body.error, "Failed to process Stripe webhook.");
  assert.equal(JSON.stringify(response).includes("sk_live_secret"), false);
  assert.equal(JSON.stringify(env.alerts).includes("sk_live_secret"), false);
  assert.equal(JSON.stringify(env.alerts).includes("Bearer tok"), false);
  assert.match(env.alerts[0].errorMessage, /Redacted/);
  assert.equal(env.store.orders().length, 1);
  assert.equal(env.store.balance({ userId }).purchased, 100);
});

test("stripe checkout rejects metadata that conflicts with the persisted customer owner", async () => {
  const env = harness();
  const owner = id();
  const other = id();
  env.store.seedUser(owner, { stripeCustomerId: "cus_owner" });
  env.store.seedUser(other);
  const provider = await createStripeProvider({
    commerce: env.commerce,
    webhookSecret: "whsec_contract",
    apiKey: "sk_test_123",
  });

  await assert.rejects(
    () =>
      provider.fulfillCheckout({
        id: `cs_${id().replaceAll("-", "").slice(0, 16)}`,
        mode: "payment",
        payment_status: "paid",
        metadata: { userId: other, planId: "pack" },
        customer: "cus_owner",
        payment_intent: "pi_contract",
        amount_total: 1000,
        amount_subtotal: 1000,
        total_details: { amount_discount: 0, amount_tax: 0 },
        currency: "usd",
        line_items: {
          data: [{ price: { id: "price_pack" }, quantity: 1 }],
          has_more: false,
        },
      }),
    /ownership conflict/,
  );
  assert.equal(env.store.orders().length, 0);
  assert.equal(env.store.balance({ userId: owner }).purchased, 0);
  assert.equal(env.store.balance({ userId: other }).purchased, 0);
});

test("enabling a provider without its configuration fails before a client exists", async () => {
  const env = harness();
  await assert.rejects(
    () => createStripeProvider({ commerce: env.commerce }),
    /webhookSecret is missing/,
  );
  await assert.rejects(
    () => createStripeProvider({ commerce: env.commerce, webhookSecret: "whsec" }),
    /apiKey is missing/,
  );
  await assert.rejects(
    () => createCreemProvider({ commerce: env.commerce }),
    /webhookSecret is missing/,
  );
  await assert.rejects(
    () => createCreemProvider({ commerce: env.commerce, webhookSecret: "whsec", webhooks: {} }),
    /did not export webhook helpers/,
  );
  await assert.rejects(
    () =>
      createStripeProvider({
        commerce: env.commerce,
        webhookSecret: "whsec",
        client: {
          constructEvent() {
            return {};
          },
        },
      }),
    /webhooks\.constructEvent/,
  );
  assert.throws(
    () =>
      createPayPalProvider({
        webhookId: "",
        commerce: env.commerce,
        transport: { verifySignature: async () => ({ status: 200 }) },
      }),
    /webhookId is missing/,
  );
});

test("PayPal verification treats 4xx as final and retries 5xx", async () => {
  const headers = {
    authAlgo: "SHA256withRSA",
    certUrl: "https://example.invalid/cert",
    transmissionId: "t",
    transmissionSig: "s",
    transmissionTime: "now",
  };
  let calls = 0;
  const denied = await verifyPayPalWebhookSignature({
    headers,
    rawBody: "{}",
    webhookId: "WH",
    sleep: async () => {},
    transport: {
      async verifySignature() {
        calls += 1;
        return { status: 401 };
      },
    },
  });
  assert.equal(denied, false);
  assert.equal(calls, 1);
  calls = 0;
  const recovered = await verifyPayPalWebhookSignature({
    headers,
    rawBody: "{}",
    webhookId: "WH",
    sleep: async () => {},
    transport: {
      async verifySignature() {
        calls += 1;
        return calls === 1 ? { status: 503 } : { status: 200, verificationStatus: "SUCCESS" };
      },
    },
  });
  assert.equal(recovered, true);
  assert.equal(calls, 2);
});

test("duplicate subscription settlement retries a temporary refund and stops on a permanent refusal", async () => {
  const env = harness();
  let attempts = 0;
  await assert.rejects(
    () =>
      env.commerce.settleDuplicateSubscription({
        provider: "paypal",
        providerSubscriptionId: "sub",
        providerOrderId: "sale",
        winner: { provider: "stripe", providerSubscriptionId: "winner" },
        amountTotal: 100,
        currency: "usd",
        userId: id(),
        refund: async () => {
          attempts += 1;
          throw new Error("timeout");
        },
      }),
    DuplicateRefundFailedError,
  );
  assert.equal(attempts, 1);
  await assert.rejects(
    () =>
      env.commerce.settleDuplicateSubscription({
        provider: "paypal",
        providerSubscriptionId: "sub",
        providerOrderId: "sale-2",
        winner: { provider: "stripe", providerSubscriptionId: "winner" },
        amountTotal: 100,
        currency: "usd",
        userId: id(),
        refund: async () => {
          throw new PermanentFulfillmentError("refund it manually");
        },
      }),
    PermanentFulfillmentError,
  );
});

test("stripe invoice and subscription events map vendor objects through the real SDK", async () => {
  const env = harness();
  const userId = id();
  env.store.seedUser(userId);
  const secret = "whsec_invoice_secret";
  const stripe = new Stripe("sk_test_123");
  const subscriptionId = "sub_vendor_1";
  let subscriptionLoads = 0;
  const subscription = {
    id: subscriptionId,
    object: "subscription",
    status: "active",
    customer: "cus_vendor",
    metadata: { userId, planId: "monthly" },
    cancel_at_period_end: false,
    canceled_at: null,
    ended_at: null,
    items: {
      object: "list",
      has_more: false,
      data: [
        {
          id: "si_1",
          price: { id: "price_month" },
          quantity: 1,
          current_period_start: 1767225600,
          current_period_end: 1769904000,
        },
      ],
    },
  };
  const invoice = {
    id: "in_vendor_1",
    object: "invoice",
    status: "paid",
    currency: "usd",
    amount_paid: 2000,
    subtotal: 1800,
    billing_reason: "subscription_cycle",
    parent: { subscription_details: { subscription: subscriptionId } },
    total_discount_amounts: [{ amount: 20 }],
    total_taxes: [{ amount: 5 }],
    payments: { data: [{ payment: { payment_intent: "pi_vendor" } }] },
  };
  const provider = await createStripeProvider({
    commerce: env.commerce,
    webhookSecret: secret,
    apiKey: "sk_test_123",
    getSubscription: async (id) => {
      subscriptionLoads += 1;
      assert.equal(id, subscriptionId);
      return subscription;
    },
    getInvoice: async () => {
      throw new Error("invoice lookup must not run when payments are on the payload");
    },
    getCustomer: async () => {
      throw new Error("customer lookup must not run when metadata.userId resolves");
    },
  });
  const payload = JSON.stringify({
    id: "evt_invoice",
    object: "event",
    type: "invoice.paid",
    data: { object: invoice },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  assert.equal((await provider.webhook()(payload, header)).status, 200);
  assert.equal((await provider.webhook()(payload, header)).status, 200);
  assert.equal(subscriptionLoads, 2);
  assert.equal(env.store.balance({ userId }).subscription, 100);
  assert.equal(env.store.orders().length, 1);
  const updated = JSON.stringify({
    id: "evt_sub",
    object: "event",
    type: "customer.subscription.updated",
    data: { object: { ...subscription, status: "past_due" } },
  });
  assert.equal(
    (
      await provider.webhook()(
        updated,
        stripe.webhooks.generateTestHeaderString({ payload: updated, secret }),
      )
    ).status,
    200,
  );
  assert.equal(
    (await env.store.transaction((unit) => unit.subscriptions.findByKey("stripe", subscriptionId)))
      .status,
    "past_due",
  );
  const deleted = JSON.stringify({
    id: "evt_del",
    object: "event",
    type: "customer.subscription.deleted",
    data: { object: { ...subscription, status: "canceled", canceled_at: 1769904000 } },
  });
  assert.equal(
    (
      await provider.webhook()(
        deleted,
        stripe.webhooks.generateTestHeaderString({ payload: deleted, secret }),
      )
    ).status,
    200,
  );
  assert.equal(
    (await env.store.transaction((unit) => unit.subscriptions.findByKey("stripe", subscriptionId)))
      .status,
    "canceled",
  );
  assert.equal(env.store.orders().length, 1);
});

test("creem real SDK payloads fulfill checkout, subscription, dispute, and reject drift", async () => {
  const env = harness();
  const userId = id();
  env.store.seedUser(userId);
  const webhooks = await loadCreemWebhooks();
  const provider = await createCreemProvider({
    commerce: env.commerce,
    webhookSecret: CREEM_SECRET,
    webhooks,
  });
  const { iso, now } = creemStamp();
  const ping = JSON.stringify({
    type: "ping",
    data: { id: "not-an-entity", object: { nope: true } },
  });
  assert.equal((await provider.webhook()(ping, creemHeaders(ping))).status, 200);
  assert.equal(env.store.orders().length, 0);
  const checkout = creemEvent("checkout.completed", {
    id: "chk_1",
    mode: "test",
    object: "checkout",
    status: "completed",
    product: creemProduct("prod_pack", "onetime", "once"),
    customer: creemCustomer("cust_creem"),
    metadata: { userId, planId: "creem-pack" },
    order: {
      id: "ord_creem_1",
      mode: "test",
      object: "order",
      product: "prod_pack",
      amount: 1000,
      amount_paid: 1000,
      currency: "USD",
      status: "paid",
      type: "onetime",
      created_at: iso,
      updated_at: iso,
      transaction: "tran_chk",
    },
  });
  assert.equal((await provider.webhook()(checkout, creemHeaders(checkout))).status, 200);
  assert.equal(env.store.balance({ userId }).purchased, 100);
  const drift = JSON.stringify({ type: "checkout.completed", object: { id: "chk_drift" } });
  assert.equal((await provider.webhook()(drift, creemHeaders(drift))).status, 500);
  assert.equal(env.store.orders().length, 1);
  const paid = creemEvent("subscription.paid", {
    id: "sub_creem_1",
    mode: "test",
    object: "subscription",
    product: creemProduct("prod_creem_month", "recurring", "every-month"),
    customer: creemCustomer("cust_creem"),
    collection_method: "charge_automatically",
    status: "active",
    metadata: { userId, planId: "creem-monthly" },
    current_period_start_date: iso,
    current_period_end_date: iso,
    created_at: iso,
    updated_at: iso,
    last_transaction: {
      id: "tran_sub_1",
      mode: "test",
      object: "transaction",
      amount: 2000,
      amount_paid: 2000,
      currency: "USD",
      type: "invoice",
      status: "paid",
      created_at: now,
    },
  });
  assert.equal((await provider.webhook()(paid, creemHeaders(paid))).status, 200);
  assert.equal((await provider.webhook()(paid, creemHeaders(paid))).status, 200);
  assert.equal(env.store.balance({ userId }).subscription, 40);
  const unpaid = creemEvent("subscription.paid", {
    id: "sub_creem_2",
    mode: "test",
    object: "subscription",
    product: creemProduct("prod_creem_month", "recurring", "every-month"),
    customer: creemCustomer("cust_creem"),
    collection_method: "charge_automatically",
    status: "active",
    metadata: { userId, planId: "creem-monthly" },
    created_at: iso,
    updated_at: iso,
  });
  assert.equal((await provider.webhook()(unpaid, creemHeaders(unpaid))).status, 500);
  const dispute = creemEvent("dispute.created", {
    id: "disp_1",
    mode: "test",
    object: "dispute",
    amount: 1000,
    currency: "USD",
    created_at: now,
    transaction: {
      id: "tran_chk",
      mode: "test",
      object: "transaction",
      amount: 1000,
      currency: "USD",
      type: "payment",
      status: "paid",
      created_at: now,
    },
  });
  const balance = env.store.balance({ userId });
  assert.equal((await provider.webhook()(dispute, creemHeaders(dispute))).status, 200);
  assert.equal(env.notices.at(-1).disputeId, "disp_1");
  assert.deepEqual(env.store.balance({ userId }), balance);
  assert.equal(env.store.orders().length, 2);
});

test("paypal lifecycle events map the loaded vendor subscription and do not grant on activation", async () => {
  const env = harness();
  const userId = id();
  env.store.seedUser(userId);
  const subId = `I-${id()}`;
  let loads = 0;
  const vendor = {
    id: subId,
    status: "ACTIVE",
    plan_id: "P-MONTH",
    custom_id: `${userId}|paypal-monthly|`,
    subscriber: { payer_id: "PAYER1" },
    billing_info: {
      last_payment: { time: "2026-01-01T00:00:00.000Z" },
      next_billing_time: "2026-02-01T00:00:00.000Z",
    },
  };
  const headers = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://example.invalid/cert",
    "paypal-transmission-id": id(),
    "paypal-transmission-sig": "sig",
    "paypal-transmission-time": "now",
  };
  const provider = createPayPalProvider({
    webhookId: "WH-test",
    commerce: env.commerce,
    transport: {
      async verifySignature() {
        return { status: 200, verificationStatus: "SUCCESS" };
      },
    },
    loadSubscription: async (idValue) => {
      loads += 1;
      assert.equal(idValue, subId);
      return vendor;
    },
  });
  const send = (eventType, resource) =>
    provider.webhook()(JSON.stringify({ event_type: eventType, resource }), headers);
  assert.equal((await send("BILLING.SUBSCRIPTION.ACTIVATED", { id: subId })).status, 200);
  assert.equal(
    (await env.store.transaction((unit) => unit.subscriptions.findByKey("paypal", subId))).status,
    "active",
  );
  assert.equal(env.store.balance({ userId }).subscription, 0);
  assert.equal(
    (await send("BILLING.SUBSCRIPTION.SUSPENDED", { id: subId, status: "SUSPENDED" })).status,
    200,
  );
  assert.equal(
    (await env.store.transaction((unit) => unit.subscriptions.findByKey("paypal", subId))).status,
    "active",
  );
  const missing = createPayPalProvider({
    webhookId: "WH-test",
    commerce: env.commerce,
    transport: {
      async verifySignature() {
        return { status: 200, verificationStatus: "SUCCESS" };
      },
    },
  });
  assert.equal(
    (
      await missing.webhook()(
        JSON.stringify({ event_type: "BILLING.SUBSCRIPTION.UPDATED", resource: { id: subId } }),
        headers,
      )
    ).status,
    500,
  );
  assert.equal(
    (await env.store.transaction((unit) => unit.subscriptions.findByKey("paypal", subId))).status,
    "active",
  );
  const saleId = `sale-${id()}`;
  assert.equal(
    (
      await send("PAYMENT.SALE.COMPLETED", {
        id: saleId,
        billing_agreement_id: subId,
        amount: { total: "10.00", currency: "USD" },
        create_time: "2026-01-01T00:00:00.000Z",
      })
    ).status,
    200,
  );
  assert.equal(env.store.balance({ userId }).subscription, 30);
  assert.equal(
    env.store.orders().some((row) => row.providerOrderId === saleId),
    true,
  );
  assert.equal(loads, 3);
  assert.equal(
    await env.store.transaction((unit) => unit.identity.readProviderCustomer(userId, "paypal")),
    "PAYER1",
  );
});
