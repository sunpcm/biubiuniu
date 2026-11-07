import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, closeDatabase } from "@/lib/db";
import { creditBalances, creditTransactions, orders, subscriptions, user } from "@/lib/db/schema";
import { buildSourceIdentityCatalog } from "@/lib/pricing/source-identity";
import { encodePayPalCustomId } from "@/lib/paypal/metadata";
import { createPayPalWebhookHandler } from "@/lib/paypal/webhook";
import { RefundHistoryIncompleteError } from "@/lib/billing/fulfillment";
import { createDomainCommerce } from "./commerce-assembly";
import type { CreemRefund } from "@/lib/creem/types";
import type { PayPalOrder, PayPalSubscription } from "@/lib/paypal/types";
import { migrate, resetSyntheticData } from "./helpers";

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
  {
    id: "paypal-sub",
    provider: "paypal",
    kind: "subscription",
    interval: "month",
    price: 10,
    currency: "USD",
    monthlyCredits: 40,
    paypalPlanId: { test: "P-TEST", live: "P-LIVE" },
    copy: { en: { name: "Sub", description: "", features: [] } },
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
const { fulfillPayPalCaptureById, handlePayPalSaleCompleted } = domain.paypal;
const { reconcileOverdueRenewals, reconcilePendingPayPalCaptures } = domain.reconcile;
const { applyRefund, fulfillOneTimePurchase, handleSubscriptionEnded } = domain.fulfillment;
const { applyCreemRefund } = domain.creem;
const { getUserCredits } = domain.credits;

before(async () => {
  await migrate();
});
after(async () => {
  await closeDatabase();
});

async function actor() {
  const [row] = await db
    .insert(user)
    .values({ email: `${randomUUID()}@example.invalid` })
    .returning();
  return row.id;
}

test("lost PayPal capture reconciles once, page replay does not charge again, and partial refunds accumulate by id", async () => {
  await resetSyntheticData();
  const userId = await actor();
  const orderId = `pp_${randomUUID()}`;
  const captureId = `cap_${randomUUID()}`;
  await recordPayPalSourceBinding({
    orderId,
    userId,
    organizationId: null,
    planId: "paypal-pack",
    amountTotal: 1000,
    currency: "usd",
  });
  await db.execute(
    sql`update orders set created_at = now() - interval '3 hours', updated_at = now() - interval '3 hours' where provider_order_id = ${orderId}`,
  );
  const customId = encodePayPalCustomId({ userId, planId: "paypal-pack" });
  let captures = 0;
  const pending = await reconcilePendingPayPalCaptures(10, {
    paypal: {
      getOrder: async (): Promise<PayPalOrder> => {
        captures += 1;
        return {
          id: orderId,
          status: "COMPLETED",
          intent: "CAPTURE",
          create_time: new Date().toISOString(),
          update_time: new Date().toISOString(),
          links: [],
          purchase_units: [
            {
              custom_id: customId,
              amount: { currency_code: "USD", value: "10.00" },
              payments: {
                captures: [
                  {
                    id: captureId,
                    status: "COMPLETED",
                    amount: { currency_code: "USD", value: "10.00" },
                    custom_id: customId,
                    create_time: "2026-01-01T00:00:00.000Z",
                  },
                ],
              },
            },
          ],
        };
      },
    },
  });
  assert.equal(pending.fulfilled, 1);
  assert.equal(captures, 1);
  assert.equal((await getUserCredits(userId)).purchasedCredits, 100);
  const page = await fulfillPayPalCaptureById(captureId, userId, {
    getCapture: async () => ({
      id: captureId,
      status: "COMPLETED",
      amount: { currency_code: "USD", value: "10.00" },
      custom_id: customId,
      create_time: "2026-01-01T00:00:00.000Z",
    }),
  });
  assert.equal(page.paid, true);
  assert.equal((await getUserCredits(userId)).purchasedCredits, 100);

  const handler = createPayPalWebhookHandler({
    app: domain.app,
    webhookId: "WH-history",
    notify: async () => {},
    transport: {
      async verifySignature() {
        return { status: 200, verificationStatus: "SUCCESS" };
      },
    },
  });
  const refund = (id: string, value: string, cumulative?: string) =>
    handler(
      new Request("https://fixture.invalid/api/paypal/webhook", {
        method: "POST",
        body: JSON.stringify({
          id: randomUUID(),
          event_type: "PAYMENT.CAPTURE.REFUNDED",
          resource: {
            id,
            amount: { value, currency_code: "USD" },
            ...(cumulative
              ? {
                  seller_payable_breakdown: {
                    total_refunded_amount: { value: cumulative, currency_code: "USD" },
                  },
                }
              : {}),
            links: [
              {
                rel: "up",
                href: `https://api.paypal.com/v2/payments/captures/${captureId}`,
                method: "GET",
              },
            ],
          },
        }),
        headers: {
          "paypal-auth-algo": "SHA256withRSA",
          "paypal-cert-url": "https://api.paypal.com/cert/fixture",
          "paypal-transmission-id": randomUUID(),
          "paypal-transmission-sig": "ok",
          "paypal-transmission-time": new Date().toISOString(),
        },
      }),
    );
  assert.equal((await refund("refund-b", "2.00")).status, 200);
  assert.equal((await refund("refund-a", "3.00")).status, 200);
  assert.equal((await refund("refund-b", "2.00")).status, 200);
  let [row] = await db.select().from(orders).where(eq(orders.providerPaymentId, captureId));
  assert.equal(row.amountRefunded, 500);
  assert.equal(row.status, "partially_refunded");
  assert.equal((await getUserCredits(userId)).purchasedCredits, 50);
  const overflow = await refund("refund-too-big", "6.00");
  assert.equal(overflow.status, 500);
  [row] = await db.select().from(orders).where(eq(orders.providerPaymentId, captureId));
  assert.equal(row.amountRefunded, 500);
  assert.equal((await refund("refund-stale", "4.00", "4.00")).status, 200);
  assert.equal((await refund("refund-full", "10.00", "10.00")).status, 200);
  assert.equal((await refund("refund-full", "10.00", "10.00")).status, 200);
  [row] = await db.select().from(orders).where(eq(orders.providerPaymentId, captureId));
  assert.equal(row.amountRefunded, 1000);
  assert.equal(row.status, "refunded");
  assert.equal((await getUserCredits(userId)).purchasedCredits, 0);
  assert.equal((await refund("refund-after", "1.00")).status, 500);
  [row] = await db.select().from(orders).where(eq(orders.providerPaymentId, captureId));
  assert.equal(row.amountRefunded, 1000);
});

test("PayPal renewal reconcile grants once and a terminal sale does not revive credits", async () => {
  await resetSyntheticData();
  const userId = await actor();
  const subscriptionId = `I-${randomUUID()}`;
  const periodStart = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  const periodEnd = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await db.insert(subscriptions).values({
    userId,
    organizationId: null,
    planId: "paypal-sub",
    provider: "paypal",
    providerSubscriptionId: subscriptionId,
    providerPriceId: "P-TEST",
    status: "active",
    interval: "month",
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    monthlyCredits: 40,
  });
  await db.insert(orders).values({
    userId,
    organizationId: null,
    planId: "paypal-sub",
    orderType: "subscription_initial",
    status: "completed",
    creditsGranted: 40,
    amountTotal: 1000,
    currency: "usd",
    provider: "paypal",
    providerOrderId: `initial_${randomUUID()}`,
    providerSubscriptionId: subscriptionId,
  });
  await db.execute(
    sql`update subscriptions set updated_at = now() - interval '3 hours' where provider_subscription_id = ${subscriptionId}`,
  );
  const paypalSub = (): PayPalSubscription => ({
    id: subscriptionId,
    status: "ACTIVE",
    plan_id: "P-TEST",
    custom_id: encodePayPalCustomId({ userId, planId: "paypal-sub" }),
    billing_info: {
      cycle_executions: [],
      last_payment: {
        amount: { currency_code: "USD", value: "10.00" },
        time: periodStart.toISOString(),
      },
      next_billing_time: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
    },
    create_time: periodStart.toISOString(),
    update_time: new Date().toISOString(),
    links: [],
  });
  const windows: { startTime: string; endTime: string }[] = [];
  const deps = {
    paypal: {
      getSubscription: async () => paypalSub(),
      listSubscriptionTransactions: async (
        _id: string,
        range: { startTime: string; endTime: string },
      ) => {
        windows.push(range);
        return [
          { id: "DECLINED-1", status: "DECLINED", time: periodEnd.toISOString() },
          {
            id: "SALE-RENEW",
            status: "COMPLETED",
            time: periodEnd.toISOString(),
            amount_with_breakdown: { gross_amount: { currency_code: "USD", value: "10.00" } },
          },
        ];
      },
    },
  };
  const renewed = await reconcileOverdueRenewals(10, deps);
  assert.equal(renewed.fulfilled, 1);
  assert.equal(windows[0]?.startTime, periodStart.toISOString());
  const renewal = (
    await db.select().from(orders).where(eq(orders.providerOrderId, "SALE-RENEW"))
  )[0];
  assert.equal(renewal.orderType, "subscription_renewal");
  assert.equal(renewal.creditsGranted, 40);
  assert.equal((await getUserCredits(userId)).subscriptionCredits, 40);
  assert.equal(
    (await db.select().from(orders).where(eq(orders.providerOrderId, "DECLINED-1"))).length,
    0,
  );

  await handleSubscriptionEnded("paypal", subscriptionId, {
    status: "canceled",
    canceledAt: new Date(),
  });
  assert.equal((await getUserCredits(userId)).subscriptionCredits, 0);
  await handlePayPalSaleCompleted(
    {
      id: "SALE-LATE",
      state: "completed",
      amount: { total: "10.00", currency: "USD" },
      billing_agreement_id: subscriptionId,
      create_time: new Date().toISOString(),
    },
    deps.paypal,
  );
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.providerSubscriptionId, subscriptionId));
  assert.equal(sub.status, "canceled");
  assert.equal(sub.remainingGrants, 0);
  assert.equal(sub.nextGrantAt, null);
  assert.equal((await getUserCredits(userId)).subscriptionCredits, 0);
  const late = (await db.select().from(orders).where(eq(orders.providerOrderId, "SALE-LATE")))[0];
  assert.equal(late.creditsGranted, 0);

  const blockedId = `I-${randomUUID()}`;
  await db.insert(subscriptions).values({
    userId,
    organizationId: null,
    planId: "paypal-sub",
    provider: "paypal",
    providerSubscriptionId: blockedId,
    providerPriceId: "P-TEST",
    status: "active",
    interval: "month",
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    monthlyCredits: 40,
  });
  await db.execute(
    sql`update subscriptions set updated_at = now() - interval '3 hours' where provider_subscription_id = ${blockedId}`,
  );
  const blocked = await reconcileOverdueRenewals(10, {
    paypal: {
      getSubscription: async () => ({ ...paypalSub(), id: blockedId }),
      listSubscriptionTransactions: async () => [
        {
          id: "PART-1",
          status: "PARTIALLY_REFUNDED",
          time: periodEnd.toISOString(),
          amount_with_breakdown: { gross_amount: { currency_code: "USD", value: "10.00" } },
        },
      ],
    },
  });
  assert.equal(blocked.failed, 1);
  assert.equal(
    (await db.select().from(orders).where(eq(orders.providerOrderId, "PART-1"))).length,
    0,
  );
  assert.equal((await getUserCredits(userId)).subscriptionCredits, 0);

  const refundedSale = `SALE-REFUNDED-${randomUUID()}`;
  await db.insert(orders).values({
    userId,
    organizationId: null,
    planId: "paypal-sub",
    orderType: "subscription_renewal",
    status: "completed",
    creditsGranted: 40,
    amountTotal: 1000,
    amountRefunded: 0,
    currency: "usd",
    provider: "paypal",
    providerOrderId: refundedSale,
    providerSubscriptionId: blockedId,
  });
  await db.execute(
    sql`update subscriptions set updated_at = now() - interval '3 hours' where provider_subscription_id = ${blockedId}`,
  );
  const incompleteRefund = await reconcileOverdueRenewals(10, {
    paypal: {
      getSubscription: async () => ({ ...paypalSub(), id: blockedId }),
      listSubscriptionTransactions: async () => [
        {
          id: refundedSale,
          status: "REFUNDED",
          time: periodEnd.toISOString(),
          amount_with_breakdown: { gross_amount: { currency_code: "USD", value: "10.00" } },
        },
      ],
    },
  });
  assert.equal(incompleteRefund.failed, 1);
  assert.equal(incompleteRefund.fulfilled, 0);
  const [unchanged] = await db
    .select()
    .from(orders)
    .where(eq(orders.providerOrderId, refundedSale));
  assert.equal(unchanged.amountRefunded, 0);
  assert.equal(unchanged.status, "completed");
  assert.equal((await getUserCredits(userId)).subscriptionCredits, 0);
});

test("Creem partial refunds sum by id, and a historical total without ids does not absorb an unknown delta", async () => {
  await resetSyntheticData();
  const userId = await actor();
  const orderId = `creem_${randomUUID()}`;
  await fulfillOneTimePurchase({
    provider: "creem",
    providerOrderId: orderId,
    subject: { userId, organizationId: null },
    planId: "pack",
    credits: 100,
    amountTotal: 1000,
    currency: "usd",
  });
  const refund = (id: string, amount: number, refundedAmount?: number): CreemRefund => ({
    id,
    mode: "test",
    object: "refund",
    status: "succeeded",
    refundAmount: amount,
    refundCurrency: "USD",
    reason: "requested_by_customer",
    createdAt: Date.now(),
    order: orderId,
    transaction: {
      id: `tran_${orderId}`,
      mode: "test",
      object: "transaction",
      amount: 1000,
      currency: "USD",
      type: "payment",
      status: "paid",
      createdAt: Date.now(),
      refundedAmount: refundedAmount ?? null,
    },
  });
  await applyCreemRefund(refund("c-b", 200));
  await applyCreemRefund(refund("c-a", 300));
  await applyCreemRefund(refund("c-a", 300));
  let [row] = await db.select().from(orders).where(eq(orders.providerOrderId, orderId));
  assert.equal(row.amountRefunded, 500);
  assert.equal((await getUserCredits(userId)).purchasedCredits, 50);
  await applyCreemRefund(refund("c-full", 1000, 1000));
  [row] = await db.select().from(orders).where(eq(orders.providerOrderId, orderId));
  assert.equal(row.amountRefunded, 1000);

  const historicalId = `old_${randomUUID()}`;
  await fulfillOneTimePurchase({
    provider: "paypal",
    providerOrderId: historicalId,
    subject: { userId, organizationId: null },
    planId: "pack",
    credits: 100,
    amountTotal: 1000,
    currency: "usd",
  });
  await db
    .update(orders)
    .set({ amountRefunded: 400, status: "partially_refunded" })
    .where(eq(orders.providerOrderId, historicalId));
  await db
    .update(creditBalances)
    .set({ purchasedCredits: 60 })
    .where(eq(creditBalances.userId, userId));
  const bystanderId = await actor();
  await fulfillOneTimePurchase({
    provider: "paypal",
    providerOrderId: `bystander_${randomUUID()}`,
    subject: { userId: bystanderId, organizationId: null },
    planId: "pack",
    credits: 15,
    amountTotal: 150,
    currency: "usd",
  });
  const beforeOrder = (
    await db.select().from(orders).where(eq(orders.providerOrderId, historicalId))
  )[0];
  const beforeMeta = JSON.stringify(beforeOrder.metadata ?? null);
  const beforeTx = (await db.select({ id: creditTransactions.id }).from(creditTransactions)).length;
  const rejectUnknown = (refundId: string, amount: number) =>
    assert.rejects(
      () =>
        applyRefund({
          provider: "paypal",
          providerOrderId: historicalId,
          amountRefunded: amount,
          cumulative: false,
          refundId,
        }),
      RefundHistoryIncompleteError,
    );
  await rejectUnknown("same-amount-unknown", 400);
  await rejectUnknown("other-amount-unknown", 100);
  await rejectUnknown("same-amount-unknown", 400);
  [row] = await db.select().from(orders).where(eq(orders.providerOrderId, historicalId));
  assert.equal(row.amountRefunded, 400);
  assert.equal(row.status, "partially_refunded");
  assert.equal(JSON.stringify(row.metadata ?? null), beforeMeta);
  assert.equal((await getUserCredits(userId)).purchasedCredits, 60);
  assert.equal(
    (await db.select({ id: creditTransactions.id }).from(creditTransactions)).length,
    beforeTx,
  );
  assert.equal((await getUserCredits(bystanderId)).purchasedCredits, 15);

  await applyRefund({
    provider: "paypal",
    providerOrderId: historicalId,
    amountRefunded: 700,
    cumulative: true,
    refundId: "official-700",
  });
  await applyRefund({
    provider: "paypal",
    providerOrderId: historicalId,
    amountRefunded: 700,
    cumulative: true,
    refundId: "official-700",
  });
  await applyRefund({
    provider: "paypal",
    providerOrderId: historicalId,
    amountRefunded: 400,
    cumulative: true,
    refundId: "stale-official",
  });
  [row] = await db.select().from(orders).where(eq(orders.providerOrderId, historicalId));
  assert.equal(row.amountRefunded, 700);
  assert.equal(row.status, "partially_refunded");
  assert.equal((await getUserCredits(userId)).purchasedCredits, 30);
  await applyRefund({
    provider: "paypal",
    providerOrderId: historicalId,
    amountRefunded: 1000,
    cumulative: true,
    refundId: "official-1000",
  });
  await applyRefund({
    provider: "paypal",
    providerOrderId: historicalId,
    amountRefunded: 700,
    cumulative: true,
    refundId: "official-700",
  });
  [row] = await db.select().from(orders).where(eq(orders.providerOrderId, historicalId));
  assert.equal(row.amountRefunded, 1000);
  assert.equal(row.status, "refunded");
  assert.equal((await getUserCredits(userId)).purchasedCredits, 0);
  assert.equal((await getUserCredits(bystanderId)).purchasedCredits, 15);
});
