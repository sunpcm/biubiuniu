import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, closeDatabase } from "@/lib/db";
import {
  user,
  session,
  member,
  organization,
  orders,
  creditTransactions,
  creditBalances,
  organizationCreditBalances,
} from "@/lib/db/schema";
import { createServerGuards } from "@/lib/auth/guards";
import { createPayPalCaptureHandler } from "@/lib/paypal/capture";
import { createPayPalWebhookHandler } from "@/lib/paypal/webhook";
import { createDomainCommerce } from "./commerce-assembly";
import { buildSourceIdentityCatalog } from "@/lib/pricing/source-identity";
import { encodePayPalCustomId } from "@/lib/paypal/metadata";
import { assembleAuth } from "./auth-assembly";
import { migrate, resetSyntheticData } from "./helpers";

const { auth, mail } = assembleAuth();
const catalog = buildSourceIdentityCatalog([
  {
    id: "paypal-pack",
    provider: "paypal",
    kind: "credit_pack",
    price: 10,
    currency: "USD",
    credits: 100,
    copy: { en: { name: "Pack", description: "", features: [] } },
  },
]);
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
async function signIn() {
  const email = `${randomUUID()}@example.invalid`;
  await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
  const otp = mail.last()!.options.reactProps!.otp as string;
  const result = await auth.api.signInEmailOTP({ body: { email, otp }, returnHeaders: true });
  const cookie = result.headers.get("set-cookie")!.split(";")[0];
  const guards = createServerGuards({ auth, db, getHeaders: async () => new Headers({ cookie }) });
  const identity = await guards.getFreshSession();
  assert.ok(identity);
  return { cookie, userId: identity.user.id, guards };
}
async function businessSnapshot() {
  return JSON.stringify(
    await Promise.all([
      db.select().from(orders).orderBy(orders.id),
      db.select().from(creditTransactions).orderBy(creditTransactions.id),
      db.select().from(creditBalances).orderBy(creditBalances.userId),
      db
        .select()
        .from(organizationCreditBalances)
        .orderBy(organizationCreditBalances.organizationId),
    ]),
  );
}
async function fixture() {
  await resetSyntheticData();
  const buyer = await signIn();
  const other = await signIn();
  const orderId = `pp_${randomUUID()}`;
  const [org] = await db
    .insert(organization)
    .values({ name: "Original", slug: `org-${randomUUID()}` })
    .returning();
  const [membership] = await db
    .insert(member)
    .values({ userId: buyer.userId, organizationId: org.id, role: "owner" })
    .returning();
  await recordPayPalSourceBinding({
    orderId,
    userId: buyer.userId,
    organizationId: org.id,
    planId: "paypal-pack",
    amountTotal: 1000,
    currency: "USD",
  });
  const customId = encodePayPalCustomId({
    userId: buyer.userId,
    organizationId: org.id,
    planId: "paypal-pack",
  });
  const capture = {
    id: `cap_${randomUUID()}`,
    status: "COMPLETED" as const,
    amount: { value: "10.00", currency_code: "USD" },
    custom_id: customId,
    create_time: "2026-01-01T00:00:00.000Z",
  };
  let providerCalls = 0;
  const handlerFor = (cookie: string) => {
    // Exact production guard factory, actual Better Auth session + real PG.
    const guards = createServerGuards({
      auth,
      db,
      getHeaders: async () => new Headers({ cookie }),
    });
    return createPayPalCaptureHandler({
      app: domain.app,
      getFreshSession: guards.getFreshSession,
      getLocale: async () => "en",
      schedule: () => {},
      captureOrder: async () => {
        providerCalls++;
        return {
          id: orderId,
          status: "COMPLETED",
          payer: { email_address: "buyer@example.invalid", payer_id: "PAYER" },
          purchase_units: [
            {
              custom_id: customId,
              amount: { currency_code: "USD", value: "10.00" },
              payments: { captures: [capture] },
            },
          ],
        };
      },
    });
  };
  return {
    buyer,
    other,
    org,
    membership,
    orderId,
    capture,
    handlerFor,
    calls: () => providerCalls,
  };
}
const request = (orderId: string) =>
  new Request("https://fixture.invalid/api/paypal/capture-order", {
    method: "POST",
    body: JSON.stringify({ orderId }),
    headers: { "content-type": "application/json" },
  });
before(async () => {
  await migrate();
});
after(async () => {
  await closeDatabase();
});

for (const reason of ["banned", "revoked", "foreign-user", "removed-original-member"] as const) {
  test(`interactive PayPal capture rejects ${reason} before remote money; zero provider calls and business writes`, async () => {
    const f = await fixture();
    if (reason === "banned")
      await db
        .update(user)
        .set({ banned: true, banExpires: null })
        .where(eq(user.id, f.buyer.userId));
    if (reason === "revoked") await db.delete(session).where(eq(session.userId, f.buyer.userId));
    if (reason === "removed-original-member") {
      await db.delete(member).where(eq(member.id, f.membership.id));
      // Switching to a different valid workspace does not authorize the old order.
      const [newOrg] = await db
        .insert(organization)
        .values({ name: "Current", slug: `current-${randomUUID()}` })
        .returning();
      await db
        .insert(member)
        .values({ userId: f.buyer.userId, organizationId: newOrg.id, role: "owner" });
      await db
        .update(session)
        .set({ activeOrganizationId: newOrg.id })
        .where(eq(session.userId, f.buyer.userId));
    }
    const prior = await businessSnapshot();
    const res = await f.handlerFor(reason === "foreign-user" ? f.other.cookie : f.buyer.cookie)(
      request(f.orderId),
    );
    assert.ok([401, 403].includes(res.status));
    assert.equal(f.calls(), 0);
    assert.equal(await businessSnapshot(), prior);
  });
}

test("valid capture after workspace switch fulfills original bound organization; replay grants once", async () => {
  const f = await fixture();
  const signupBonusesBefore = await db
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.type, "signup_bonus"))
    .orderBy(creditTransactions.id);
  assert.equal(signupBonusesBefore.length, 2);
  assert.deepEqual(
    signupBonusesBefore.map((transaction) => transaction.userId).sort(),
    [f.buyer.userId, f.other.userId].sort(),
  );
  assert.ok(
    signupBonusesBefore.every(
      (transaction) => transaction.amount > 0 && transaction.purchasedDelta > 0,
    ),
  );

  // Current workspace is personal; membership of the original organization remains.
  await db
    .update(session)
    .set({ activeOrganizationId: null })
    .where(eq(session.userId, f.buyer.userId));
  const handler = f.handlerFor(f.buyer.cookie);
  assert.equal((await handler(request(f.orderId))).status, 200);

  const orderRows = await db.select().from(orders).where(eq(orders.providerOrderId, f.orderId));
  assert.equal(orderRows.length, 1);
  const [order] = orderRows;
  assert.ok(order);
  assert.equal(order.organizationId, f.org.id);

  const purchaseTransactions = () =>
    db
      .select()
      .from(creditTransactions)
      .where(
        and(eq(creditTransactions.orderId, order.id), eq(creditTransactions.type, "purchase")),
      );
  const purchaseBeforeReplayRows = await purchaseTransactions();
  assert.equal(purchaseBeforeReplayRows.length, 1);
  const [purchaseBeforeReplay] = purchaseBeforeReplayRows;
  assert.ok(purchaseBeforeReplay);
  assert.equal(purchaseBeforeReplay.userId, f.buyer.userId);
  assert.equal(purchaseBeforeReplay.organizationId, f.org.id);
  assert.equal(purchaseBeforeReplay.amount, 100);
  assert.equal(purchaseBeforeReplay.subscriptionDelta, 0);
  assert.equal(purchaseBeforeReplay.purchasedDelta, 100);

  const [poolBeforeReplay] = await db
    .select()
    .from(organizationCreditBalances)
    .where(eq(organizationCreditBalances.organizationId, f.org.id));
  assert.ok(poolBeforeReplay);
  assert.equal(poolBeforeReplay.purchasedCredits, 100);

  assert.equal((await handler(request(f.orderId))).status, 200);

  const purchaseAfterReplay = await purchaseTransactions();
  assert.equal(purchaseAfterReplay.length, 1);
  assert.deepEqual(purchaseAfterReplay[0], purchaseBeforeReplay);

  const [poolAfterReplay] = await db
    .select()
    .from(organizationCreditBalances)
    .where(eq(organizationCreditBalances.organizationId, f.org.id));
  assert.ok(poolAfterReplay);
  assert.equal(poolAfterReplay.purchasedCredits, 100);
  assert.deepEqual(poolAfterReplay, poolBeforeReplay);

  const signupBonusesAfter = await db
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.type, "signup_bonus"))
    .orderBy(creditTransactions.id);
  assert.deepEqual(signupBonusesAfter, signupBonusesBefore);
});

test("official already-paid webhook and refund survive buyer ban, session revocation and membership removal", async () => {
  const f = await fixture();
  await db.update(user).set({ banned: true }).where(eq(user.id, f.buyer.userId));
  await db.delete(session).where(eq(session.userId, f.buyer.userId));
  await db.delete(member).where(eq(member.id, f.membership.id));
  const handler = createPayPalWebhookHandler({
    app: domain.app,
    webhookId: "WH-fixture",
    notify: async () => {},
    transport: {
      async verifySignature() {
        return { status: 200, verificationStatus: "SUCCESS" };
      },
    },
  });
  const webhook = (event_type: string, resource: unknown) =>
    handler(
      new Request("https://fixture.invalid/api/paypal/webhook", {
        method: "POST",
        body: JSON.stringify({ id: randomUUID(), event_type, resource }),
        headers: {
          "paypal-auth-algo": "SHA256withRSA",
          "paypal-cert-url": "https://api.paypal.com/cert/fixture",
          "paypal-transmission-id": randomUUID(),
          "paypal-transmission-sig": "fixture",
          "paypal-transmission-time": new Date().toISOString(),
        },
      }),
    );
  assert.equal(
    (
      await webhook("PAYMENT.CAPTURE.COMPLETED", {
        ...f.capture,
        supplementary_data: { related_ids: { order_id: f.orderId } },
      })
    ).status,
    200,
  );
  const refund = {
    id: "refund-fixture",
    amount: { value: "10.00", currency_code: "USD" },
    seller_payable_breakdown: { total_refunded_amount: { value: "10.00", currency_code: "USD" } },
    links: [{ rel: "up", href: `https://api.paypal.com/v2/payments/captures/${f.capture.id}` }],
  };
  assert.equal((await webhook("PAYMENT.CAPTURE.REFUNDED", refund)).status, 200);
  assert.equal((await webhook("PAYMENT.CAPTURE.REFUNDED", refund)).status, 200);
  const [row] = await db.select().from(orders);
  assert.equal(row.amountRefunded, 1000);
  const [pool] = await db.select().from(organizationCreditBalances);
  assert.equal(pool.purchasedCredits, 0);
  assert.equal(f.calls(), 0); // official payment was already made, no interactive capture
});
