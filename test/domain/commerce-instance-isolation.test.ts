import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { createAppCommerce } from "@/composition/commerce";
import { createStripeWebhookHandler } from "@/lib/stripe/webhook";
import { createPgCommerceStore } from "@sunpcm/niu-persistence-pg/commerce";
import { user } from "@sunpcm/niu-persistence-pg/schema/auth";
import {
  creditBalances as commerceCreditBalances,
  creditTransactions as commerceCreditTransactions,
  orders as commerceOrders,
} from "@sunpcm/niu-persistence-pg/schema/commerce";
import type { PricingPlan } from "@/config/pricing";

const databaseAUrl = process.env.COMMERCE_PG_DATABASE_URL?.trim() ?? "";
const databaseBUrl = process.env.COMMERCE_PG_FOREIGN_DATABASE_URL?.trim() ?? "";
const expectedDatabaseA = process.env.COMMERCE_PG_EXPECTED_DATABASE?.trim() ?? "";
const expectedRole = process.env.COMMERCE_PG_EXPECTED_ROLE?.trim() ?? "";
const requiredRole = "nexty_overnight_test";
const databasePrefix = "nexty_overnight_20261105_n3_";

function databaseName(value: string): string {
  return decodeURIComponent(new URL(value).pathname.replace(/^\/+/, ""));
}

async function assertSyntheticDatabase(
  label: string,
  url: string,
  sql: postgres.Sql,
): Promise<void> {
  const database = databaseName(url);
  const role = decodeURIComponent(new URL(url).username);
  const [identity] = await sql`select current_database() as database, current_user as role`;
  assert.equal(identity?.role, requiredRole, `${label} role`);
  assert.equal(identity?.database, database, `${label} database identity`);
  assert.ok(database.startsWith(databasePrefix), `${label} database prefix`);
  assert.doesNotMatch(
    database,
    /reference|disposable|migration|(?:^|_)n2(?:_|$)/i,
    `${label} database name`,
  );
  assert.equal(role, requiredRole, `${label} URL role`);
}

function stripePlan(credits: number): PricingPlan {
  return {
    id: "shared-plan",
    provider: "stripe",
    kind: "credit_pack",
    price: 10,
    currency: "USD",
    credits,
    active: true,
    stripePriceId: {
      test: "price_shared_instance_test",
      live: "price_shared_instance_live",
    },
    copy: { en: { name: "Shared plan", description: "", features: [] } },
  };
}

function stripePayload(userId: string, sessionId: string): string {
  return JSON.stringify({
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
        payment_intent: `pi_${sessionId}`,
        amount_total: 1000,
        amount_subtotal: 1000,
        total_details: { amount_discount: 0, amount_tax: 0 },
        currency: "usd",
        metadata: { userId, planId: "shared-plan" },
        line_items: {
          data: [{ price: { id: "price_shared_instance_test" }, quantity: 1 }],
          has_more: false,
        },
      },
    },
  });
}

test(
  "two Stripe handlers keep explicit PG stores, catalogs, clocks and notifications isolated",
  {
    skip:
      databaseAUrl && databaseBUrl && expectedDatabaseA && expectedRole
        ? false
        : "two controller-injected N3 PostgreSQL URLs are required",
  },
  async () => {
    assert.equal(expectedRole, requiredRole);
    assert.equal(databaseName(databaseAUrl), expectedDatabaseA);
    assert.notEqual(databaseName(databaseAUrl), databaseName(databaseBUrl));

    const sqlA = postgres(databaseAUrl, { max: 1 });
    const sqlB = postgres(databaseBUrl, { max: 1 });
    const schema = {
      user,
      creditBalances: commerceCreditBalances,
      creditTransactions: commerceCreditTransactions,
      orders: commerceOrders,
    };
    const dbA = drizzle(sqlA, { schema });
    const dbB = drizzle(sqlB, { schema });
    const userId = randomUUID();
    const sessionId = `cs_${randomUUID()}`;
    const secret = "{{SECRET_tqym9z3e}}";
    const stripe = new Stripe("sk_test_instance_isolation_fixture");
    const scheduledA: Array<() => void | Promise<void>> = [];
    const scheduledB: Array<() => void | Promise<void>> = [];
    const noticesA: string[] = [];
    const noticesB: string[] = [];
    let verifiedIdentity = false;
    const notifier = (notices: string[]) => ({
      onOrderCommitted: async (notice: {
        planId: string;
        creditsGranted: number;
        userId: string;
      }) => {
        notices.push(`${notice.userId}:${notice.planId}:${notice.creditsGranted}`);
      },
      onDuplicateSubscription: async () => {},
      onPaymentDenied: async () => {},
      onDispute: async () => {},
    });

    const appA = createAppCommerce({
      store: createPgCommerceStore(dbA),
      catalog: {
        getPlanById: (id) => (id === "shared-plan" ? stripePlan(100) : undefined),
        findPlanByProviderPriceId: (_provider, id) =>
          id === "price_shared_instance_test" ? stripePlan(100) : undefined,
      },
      clock: { now: () => new Date("2026-01-02T03:04:05.000Z") },
      schedulePostCommit: (task) => scheduledA.push(task),
      notifier: notifier(noticesA),
      purchasesEnabled: true,
      identity: {
        getFreshPrincipal: async () => null,
        isLiveMember: async () => false,
      },
    });
    const appB = createAppCommerce({
      store: createPgCommerceStore(dbB),
      catalog: {
        getPlanById: (id) => (id === "shared-plan" ? stripePlan(300) : undefined),
        findPlanByProviderPriceId: (_provider, id) =>
          id === "price_shared_instance_test" ? stripePlan(300) : undefined,
      },
      clock: { now: () => new Date("2030-06-07T08:09:10.000Z") },
      schedulePostCommit: (task) => scheduledB.push(task),
      notifier: notifier(noticesB),
      purchasesEnabled: true,
      identity: {
        getFreshPrincipal: async () => null,
        isLiveMember: async () => false,
      },
    });

    const handlerA = createStripeWebhookHandler({
      app: appA,
      client: stripe,
      secret,
      notify: async () => {},
    });
    const handlerB = createStripeWebhookHandler({
      app: appB,
      client: stripe,
      secret,
      notify: async () => {},
    });
    const body = stripePayload(userId, sessionId);
    const request = () =>
      new Request("https://fixture.invalid/api/stripe/webhook", {
        method: "POST",
        body,
        headers: {
          "stripe-signature": stripe.webhooks.generateTestHeaderString({
            payload: body,
            secret,
          }),
        },
      });

    try {
      await Promise.all([
        assertSyntheticDatabase("primary", databaseAUrl, sqlA),
        assertSyntheticDatabase("foreign", databaseBUrl, sqlB),
      ]);
      verifiedIdentity = true;
      await dbA.insert(user).values({
        id: userId,
        email: `${userId}@example.invalid`,
      });
      await dbB.insert(user).values({
        id: userId,
        email: `${userId}@example.invalid`,
      });
      const [responseA, responseB] = await Promise.all([handlerA(request()), handlerB(request())]);
      assert.equal(responseA.status, 200);
      assert.equal(responseB.status, 200);
      assert.equal(scheduledA.length, 1);
      assert.equal(scheduledB.length, 1);
      await Promise.all([...scheduledA, ...scheduledB].map((task) => task()));

      const [balanceA] = await dbA
        .select({ purchased: commerceCreditBalances.purchasedCredits })
        .from(commerceCreditBalances)
        .where(eq(commerceCreditBalances.userId, userId));
      const [balanceB] = await dbB
        .select({ purchased: commerceCreditBalances.purchasedCredits })
        .from(commerceCreditBalances)
        .where(eq(commerceCreditBalances.userId, userId));
      assert.equal(balanceA?.purchased, 100);
      assert.equal(balanceB?.purchased, 300);

      const [orderA] = await dbA
        .select({ createdAt: commerceOrders.createdAt })
        .from(commerceOrders)
        .where(eq(commerceOrders.providerOrderId, sessionId));
      const [orderB] = await dbB
        .select({ createdAt: commerceOrders.createdAt })
        .from(commerceOrders)
        .where(eq(commerceOrders.providerOrderId, sessionId));
      assert.equal(orderA?.createdAt.toISOString(), "2026-01-02T03:04:05.000Z");
      assert.equal(orderB?.createdAt.toISOString(), "2030-06-07T08:09:10.000Z");
      assert.deepEqual(noticesA, [`${userId}:shared-plan:100`]);
      assert.deepEqual(noticesB, [`${userId}:shared-plan:300`]);
    } finally {
      if (verifiedIdentity) {
        const [identityA] = await sqlA`select current_database() as database, current_user as role`;
        const [identityB] = await sqlB`select current_database() as database, current_user as role`;
        assert.equal(identityA?.database, expectedDatabaseA);
        assert.equal(identityA?.role, requiredRole);
        assert.equal(identityB?.database, databaseName(databaseBUrl));
        assert.equal(identityB?.role, requiredRole);
        await dbA
          .delete(commerceCreditTransactions)
          .where(eq(commerceCreditTransactions.userId, userId));
        await dbA.delete(commerceCreditBalances).where(eq(commerceCreditBalances.userId, userId));
        await dbA.delete(commerceOrders).where(eq(commerceOrders.userId, userId));
        await dbA.delete(user).where(eq(user.id, userId));
        await dbB
          .delete(commerceCreditTransactions)
          .where(eq(commerceCreditTransactions.userId, userId));
        await dbB.delete(commerceCreditBalances).where(eq(commerceCreditBalances.userId, userId));
        await dbB.delete(commerceOrders).where(eq(commerceOrders.userId, userId));
        await dbB.delete(user).where(eq(user.id, userId));
      }
      await Promise.all([sqlA.end({ timeout: 5 }), sqlB.end({ timeout: 5 })]);
    }
  },
);
