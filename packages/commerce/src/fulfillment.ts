import type { CommerceRuntime } from "./context.js";
import type { OrderCommittedNotice } from "./types.js";
import { clearSubscriptionIn, grantPurchasedIn, grantUpgradeIn, resetSubscriptionIn, revokeIn } from "./credits.js";
import { addMonthsClamped, grantWindowStartAt, remainingWindowFraction, settleDueIn } from "./drip.js";
import { PermanentFulfillmentError } from "./errors.js";
import { assertMinorAmount } from "./money.js";
import { decideRefundAdvance } from "./refund.js";
import type { CommerceUnit, OrderDraft, OrderRow, SubscriptionRow } from "./store.js";
import {
  ENTITLED_SUBSCRIPTION_STATUSES, TERMINAL_SUBSCRIPTION_STATUSES,
  type BillingSubject, type OneTimePaymentInput, type PaymentProvider, type RefundInput,
  type SubscriptionEndPatch, type SubscriptionPaymentInput, type SubscriptionRef,
  type SubscriptionSyncInput, type SubscriptionUpdatePaymentInput,
} from "./types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GRANT_WINDOW_FALLBACK_MS = 31 * 24 * 60 * 60 * 1000;

export async function resolveValidUserId(rt: CommerceRuntime, candidate: string | null | undefined): Promise<string | null> {
  if (!candidate || !UUID_RE.test(candidate)) return null;
  return rt.withUnit(undefined, (unit) => unit.identity.findLivingUserId(candidate));
}

export async function resolveValidOrganizationId(rt: CommerceRuntime, candidate: string | null | undefined): Promise<string | null> {
  if (!candidate || !UUID_RE.test(candidate)) return null;
  return rt.withUnit(undefined, (unit) => unit.identity.findLivingOrganizationId(candidate));
}

export async function resolveSubject(rt: CommerceRuntime, params: { userId?: string | null; organizationId?: string | null }): Promise<BillingSubject> {
  const [userId, organizationId] = await Promise.all([
    resolveValidUserId(rt, params.userId),
    resolveValidOrganizationId(rt, params.organizationId),
  ]);
  return { userId, organizationId };
}

function moneyDraft(input: {
  provider: PaymentProvider; providerOrderId: string; providerPaymentId?: string | null;
  subject: BillingSubject; planId: string; credits: number; amountTotal: number;
  amountSubtotal?: number | null; amountDiscount?: number; amountTax?: number; currency: string;
  metadata?: Record<string, unknown> | null; orderType: OrderDraft["orderType"]; status: OrderDraft["status"];
  providerSubscriptionId?: string | null;
}, at: Date): OrderDraft {
  assertMinorAmount(input.amountTotal, "Order amount");
  assertMinorAmount(input.credits, "Credits granted");
  return {
    userId: input.subject.userId, organizationId: input.subject.organizationId, planId: input.planId,
    orderType: input.orderType, status: input.status, creditsGranted: input.credits,
    amountTotal: input.amountTotal, amountSubtotal: input.amountSubtotal ?? null,
    amountDiscount: input.amountDiscount ?? 0, amountTax: input.amountTax ?? 0, currency: input.currency,
    provider: input.provider, providerOrderId: input.providerOrderId, providerPaymentId: input.providerPaymentId ?? null,
    providerSubscriptionId: input.providerSubscriptionId ?? null, metadata: input.metadata ?? null,
    createdAt: at, updatedAt: at,
  };
}

function sameIdentity(existing: OrderRow, input: OneTimePaymentInput): boolean {
  return existing.planId === input.planId
    && (existing.userId ?? null) === (input.subject.userId ?? null)
    && (existing.organizationId ?? null) === (input.subject.organizationId ?? null)
    && existing.amountTotal === input.amountTotal
    && existing.currency.toLowerCase() === input.currency.toLowerCase()
    && (existing.providerPaymentId === null || existing.providerPaymentId === (input.providerPaymentId ?? null));
}

function notice(rt: CommerceRuntime, unit: CommerceUnit, payload: OrderCommittedNotice): void {
  const notify = rt.deps.notifier?.onOrderCommitted;
  if (!notify) return;
  rt.afterCommit(unit, () => notify(payload));
}

export async function syncSubscriptionIn(rt: CommerceRuntime, unit: CommerceUnit, input: SubscriptionSyncInput): Promise<void> {
  const at = rt.deps.clock.now();
  await unit.subscriptions.upsert({
    userId: input.subject.userId, organizationId: input.subject.organizationId, planId: input.planId,
    provider: input.provider, providerSubscriptionId: input.providerSubscriptionId,
    providerCustomerId: input.providerCustomerId ?? null, providerPriceId: input.providerPriceId ?? null,
    status: input.status, interval: input.interval,
    currentPeriodStart: input.currentPeriodStart ?? null, currentPeriodEnd: input.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false, canceledAt: input.canceledAt ?? null, endedAt: input.endedAt ?? null,
    monthlyCredits: input.monthlyCredits,
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    updatedAt: at,
  }, !TERMINAL_SUBSCRIPTION_STATUSES.includes(input.status));
}

async function sibling(unit: CommerceUnit, sub: SubscriptionSyncInput): Promise<SubscriptionRef | null> {
  const rows = await unit.subscriptions.listBySubject(sub.subject);
  for (const row of rows) {
    if (!ENTITLED_SUBSCRIPTION_STATUSES.includes(row.status)) continue;
    if (row.provider === sub.provider && row.providerSubscriptionId === sub.providerSubscriptionId) continue;
    const orders = await unit.orders.listBySubscription(row.provider, row.providerSubscriptionId);
    const winner = orders.some((order) => (
      ["subscription_initial", "subscription_renewal", "subscription_upgrade"].includes(order.orderType) && order.status !== "refunded"
    ));
    if (winner) return { provider: row.provider, providerSubscriptionId: row.providerSubscriptionId };
  }
  return null;
}

function duplicateFromMetadata(metadata: unknown): SubscriptionRef | null {
  const record = metadata as Record<string, unknown> | null;
  if (!record || record.duplicateSubscription !== true) return null;
  const provider = record.winnerProvider;
  const id = record.winnerProviderSubscriptionId;
  return typeof provider === "string" && typeof id === "string"
    ? { provider: provider as PaymentProvider, providerSubscriptionId: id } : null;
}

export async function fulfillOneTimeIn(rt: CommerceRuntime, unit: CommerceUnit, input: OneTimePaymentInput): Promise<{ created: boolean }> {
  if (!input.subject.userId && !input.subject.organizationId) {
    throw new PermanentFulfillmentError(`Cannot fulfill one-time purchase ${input.provider}/${input.providerOrderId}: no living subject`);
  }
  const at = rt.deps.clock.now();
  const inserted = await unit.orders.insertIfAbsent(moneyDraft({ ...input, credits: input.credits, orderType: "one_time", status: "completed" }, at));
  let orderId = inserted?.id;
  if (!orderId) {
    const existing = await unit.orders.lockByProviderOrder(input.provider, input.providerOrderId);
    if (!existing) throw new Error("Conflicting order disappeared");
    if (!sameIdentity(existing, input)) {
      throw new PermanentFulfillmentError(`Cannot promote pending one-time purchase ${input.provider}/${input.providerOrderId}: recorded subject/plan does not match incoming fulfillment`);
    }
    if (existing.status !== "pending") return { created: false };
    await unit.orders.update(existing.id, {
      status: "completed", creditsGranted: input.credits, amountTotal: input.amountTotal,
      amountSubtotal: input.amountSubtotal ?? null, amountDiscount: input.amountDiscount ?? 0, amountTax: input.amountTax ?? 0,
      currency: input.currency, providerPaymentId: input.providerPaymentId ?? null, metadata: input.metadata ?? null, updatedAt: at,
    });
    orderId = existing.id;
  }
  await grantPurchasedIn(rt, unit, {
    userId: input.subject.userId, organizationId: input.subject.organizationId, amount: input.credits, orderId,
    note: `Credit pack purchase (${input.planId})`,
  });
  notice(rt, unit, {
    orderType: "one_time", planId: input.planId, creditsGranted: input.credits, amountTotal: input.amountTotal,
    currency: input.currency, userId: input.subject.userId ?? "(deleted user)",
  });
  return { created: true };
}

export async function recordPendingIn(rt: CommerceRuntime, unit: CommerceUnit, input: OneTimePaymentInput): Promise<{ created: boolean }> {
  if (!input.subject.userId && !input.subject.organizationId) {
    rt.log("warn", { provider: input.provider, providerOrderId: input.providerOrderId }, "Pending purchase has no living subject; skipping local trace");
    return { created: false };
  }
  const at = rt.deps.clock.now();
  const inserted = await unit.orders.insertIfAbsent(moneyDraft({ ...input, credits: 0, orderType: "one_time", status: "pending" }, at));
  if (!inserted) {
    const existing = await unit.orders.findByProviderOrder(input.provider, input.providerOrderId);
    if (!existing || existing.orderType !== "one_time" || existing.userId !== input.subject.userId || existing.organizationId !== input.subject.organizationId
      || existing.planId !== input.planId || existing.amountTotal !== input.amountTotal
      || existing.currency.toLowerCase() !== input.currency.toLowerCase()
      || (input.providerPaymentId && existing.providerPaymentId && input.providerPaymentId !== existing.providerPaymentId)) {
      throw new Error("Pending payment identity/money conflict");
    }
  }
  return { created: inserted !== null };
}

export async function fulfillSubscriptionIn(rt: CommerceRuntime, unit: CommerceUnit, input: SubscriptionPaymentInput): Promise<{ created: boolean; duplicate: SubscriptionRef | null }> {
  const sub = input.subscription;
  await syncSubscriptionIn(rt, unit, sub);
  if (!sub.subject.userId && !sub.subject.organizationId) {
    throw new PermanentFulfillmentError(`Cannot fulfill subscription payment ${sub.provider}/${input.providerOrderId}: purchaser deleted and no organization subject`);
  }
  const subjectKey = sub.subject.organizationId ? `org:${sub.subject.organizationId}` : `user:${sub.subject.userId}`;
  await unit.subscriptions.advisoryLockSubject(`sub-fulfill-${subjectKey}`);
  const replay = await unit.orders.findByProviderOrder(sub.provider, input.providerOrderId);
  if (replay) return { created: false, duplicate: duplicateFromMetadata(replay.metadata) };
  const local = await unit.subscriptions.findByKey(sub.provider, sub.providerSubscriptionId);
  const at = rt.deps.clock.now();
  if (local && TERMINAL_SUBSCRIPTION_STATUSES.includes(local.status)) {
    const inserted = await unit.orders.insertIfAbsent(moneyDraft({
      provider: sub.provider, providerOrderId: input.providerOrderId, providerPaymentId: input.providerPaymentId,
      subject: sub.subject, planId: sub.planId, credits: 0, amountTotal: input.amountTotal,
      amountSubtotal: input.amountSubtotal, amountDiscount: input.amountDiscount, amountTax: input.amountTax,
      currency: input.currency, metadata: { ...(input.metadata ?? {}), terminalRenewalIgnored: true },
      orderType: input.orderType, status: "completed", providerSubscriptionId: sub.providerSubscriptionId,
    }, at));
    return { created: inserted !== null, duplicate: null };
  }
  const winner = await sibling(unit, sub);
  if (winner) {
    const inserted = await unit.orders.insertIfAbsent(moneyDraft({
      provider: sub.provider, providerOrderId: input.providerOrderId, providerPaymentId: input.providerPaymentId,
      subject: sub.subject, planId: sub.planId, credits: 0, amountTotal: input.amountTotal,
      amountSubtotal: input.amountSubtotal, amountDiscount: input.amountDiscount, amountTax: input.amountTax,
      currency: input.currency, providerSubscriptionId: sub.providerSubscriptionId,
      metadata: { ...(input.metadata ?? {}), duplicateSubscription: true, winnerProvider: winner.provider, winnerProviderSubscriptionId: winner.providerSubscriptionId },
      orderType: input.orderType, status: "completed",
    }, at));
    await unit.subscriptions.update(sub.provider, sub.providerSubscriptionId, {
      status: "canceled", canceledAt: at, endedAt: at, remainingGrants: 0, nextGrantAt: null, updatedAt: at,
    });
    return { created: inserted !== null, duplicate: winner };
  }
  const inserted = await unit.orders.insertIfAbsent(moneyDraft({
    provider: sub.provider, providerOrderId: input.providerOrderId, providerPaymentId: input.providerPaymentId,
    subject: sub.subject, planId: sub.planId, credits: sub.monthlyCredits, amountTotal: input.amountTotal,
    amountSubtotal: input.amountSubtotal, amountDiscount: input.amountDiscount, amountTax: input.amountTax,
    currency: input.currency, metadata: input.metadata ?? null, orderType: input.orderType, status: "completed",
    providerSubscriptionId: sub.providerSubscriptionId,
  }, at));
  if (!inserted) return { created: false, duplicate: null };
  const periodStart = input.periodStart ?? at;
  const yearly = sub.interval === "year";
  await unit.subscriptions.update(sub.provider, sub.providerSubscriptionId, {
    remainingGrants: yearly ? 11 : 0, nextGrantAt: yearly ? addMonthsClamped(periodStart, 1) : null, updatedAt: at,
  });
  await resetSubscriptionIn(rt, unit, {
    userId: sub.subject.userId, organizationId: sub.subject.organizationId, amount: sub.monthlyCredits, orderId: inserted.id,
    note: `Subscription ${input.orderType === "subscription_initial" ? "started" : "renewed"} (${sub.planId})`,
  });
  notice(rt, unit, {
    orderType: input.orderType, planId: sub.planId, creditsGranted: sub.monthlyCredits, amountTotal: input.amountTotal,
    currency: input.currency, userId: sub.subject.userId ?? "(deleted user)",
  });
  return { created: true, duplicate: null };
}

export async function fulfillUpgradeIn(rt: CommerceRuntime, unit: CommerceUnit, input: SubscriptionUpdatePaymentInput): Promise<{ created: boolean; creditsGranted: number }> {
  const sub = input.subscription;
  const before = await unit.subscriptions.findByKey(sub.provider, sub.providerSubscriptionId);
  await syncSubscriptionIn(rt, unit, sub);
  if (!sub.subject.userId && !sub.subject.organizationId) {
    if (input.amountTotal <= 0) return { created: false, creditsGranted: 0 };
    throw new PermanentFulfillmentError(`Cannot fulfill subscription upgrade ${sub.provider}/${input.providerOrderId}: purchaser deleted and no organization subject`);
  }
  const subjectKey = sub.subject.organizationId ? `org:${sub.subject.organizationId}` : `user:${sub.subject.userId}`;
  await unit.subscriptions.advisoryLockSubject(`sub-fulfill-${subjectKey}`);
  if (await unit.orders.findByProviderOrder(sub.provider, input.providerOrderId)) return { created: false, creditsGranted: 0 };
  const current = await unit.subscriptions.findByKey(sub.provider, sub.providerSubscriptionId);
  const terminal = current != null && TERMINAL_SUBSCRIPTION_STATUSES.includes(current.status);
  const now = rt.deps.clock.now();
  const windowStart = (before ? grantWindowStartAt(before.interval, before.currentPeriodStart, now) : null) ?? new Date(now.getTime() - GRANT_WINDOW_FALLBACK_MS);
  const alreadyGranted = await unit.ledger.sumSubscriptionGrantsSince({ userId: sub.subject.userId, organizationId: sub.subject.organizationId }, windowStart);
  const creditsGranted = terminal ? 0 : Math.round(Math.max(0, sub.monthlyCredits - alreadyGranted) * remainingWindowFraction(sub.interval, sub.currentPeriodStart ?? null, sub.currentPeriodEnd ?? null, now));
  if (input.amountTotal <= 0 && creditsGranted <= 0) return { created: false, creditsGranted: 0 };
  const inserted = await unit.orders.insertIfAbsent(moneyDraft({
    provider: sub.provider, providerOrderId: input.providerOrderId, providerPaymentId: input.providerPaymentId,
    subject: sub.subject, planId: sub.planId, credits: creditsGranted, amountTotal: input.amountTotal,
    amountSubtotal: input.amountSubtotal, amountDiscount: input.amountDiscount, amountTax: input.amountTax,
    currency: input.currency, metadata: input.metadata ?? null, orderType: "subscription_upgrade", status: "completed",
    providerSubscriptionId: sub.providerSubscriptionId,
  }, now));
  if (!inserted) return { created: false, creditsGranted: 0 };
  if (creditsGranted > 0) {
    await grantUpgradeIn(rt, unit, {
      userId: sub.subject.userId, organizationId: sub.subject.organizationId, amount: creditsGranted, orderId: inserted.id,
      note: `Subscription upgraded mid-cycle (${sub.planId})`,
    });
  }
  if (!terminal && (before?.interval ?? "month") !== sub.interval) {
    const yearly = sub.interval === "year";
    const periodStart = sub.currentPeriodStart ?? now;
    await unit.subscriptions.update(sub.provider, sub.providerSubscriptionId, {
      remainingGrants: yearly ? 11 : 0, nextGrantAt: yearly ? addMonthsClamped(periodStart, 1) : null, updatedAt: now,
    });
  }
  notice(rt, unit, {
    orderType: "subscription_upgrade", planId: sub.planId, creditsGranted, amountTotal: input.amountTotal,
    currency: input.currency, userId: sub.subject.userId ?? "(deleted user)",
  });
  return { created: true, creditsGranted };
}

export async function endSubscriptionIn(rt: CommerceRuntime, unit: CommerceUnit, provider: PaymentProvider, providerSubscriptionId: string, patch: SubscriptionEndPatch = {}): Promise<void> {
  const row = await unit.subscriptions.findByKey(provider, providerSubscriptionId);
  if (!row) return;
  const at = rt.deps.clock.now();
  await unit.subscriptions.update(provider, providerSubscriptionId, {
    status: patch.status ?? "canceled",
    ...(patch.canceledAt !== undefined ? { canceledAt: patch.canceledAt } : {}),
    ...(patch.endedAt !== undefined ? { endedAt: patch.endedAt } : {}),
    ...(patch.cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd: patch.cancelAtPeriodEnd } : {}),
    remainingGrants: 0, nextGrantAt: null, updatedAt: at,
  });
  const subject = { userId: row.userId, organizationId: row.organizationId };
  if (!subject.userId && !subject.organizationId) return;
  if (await unit.subscriptions.hasOtherLive(subject, row.id, ENTITLED_SUBSCRIPTION_STATUSES)) return;
  await clearSubscriptionIn(rt, unit, { userId: row.userId, organizationId: row.organizationId, note: `Subscription ${providerSubscriptionId} ended` });
}

export async function applyRefundIn(rt: CommerceRuntime, unit: CommerceUnit, input: RefundInput): Promise<{ orderFound: boolean; fullRefundOfSubscription: boolean; providerSubscriptionId: string | null }> {
  const existing = input.providerOrderId
    ? await unit.orders.findByProviderOrder(input.provider, input.providerOrderId)
    : input.providerPaymentId
      ? await unit.orders.findFirstByProviderPayment(input.provider, input.providerPaymentId)
      : null;
  if (!input.providerOrderId && !input.providerPaymentId) {
    rt.log("warn", { provider: input.provider }, "Refund has neither provider order id nor provider payment id");
    return { orderFound: false, fullRefundOfSubscription: false, providerSubscriptionId: null };
  }
  if (!existing) {
    rt.log("warn", { provider: input.provider, providerOrderId: input.providerOrderId ?? null, providerPaymentId: input.providerPaymentId ?? null }, "Refund has no matching order");
    return { orderFound: false, fullRefundOfSubscription: false, providerSubscriptionId: null };
  }
  if (typeof input.amountRefunded !== "number" || !Number.isSafeInteger(input.amountRefunded)) throw new Error("Refund amount must be a safe integer");
  if (input.amountRefunded < 0) throw new Error("Refund amount must be non-negative");
  const order = await unit.orders.lockById(existing.id);
  if (!order) return { orderFound: true, fullRefundOfSubscription: false, providerSubscriptionId: null };
  const decision = decideRefundAdvance(order, input);
  const at = rt.deps.clock.now();
  if (decision.kind === "noop") return { orderFound: true, fullRefundOfSubscription: false, providerSubscriptionId: null };
  if (decision.kind === "metadata") {
    await unit.orders.update(order.id, { metadata: decision.metadata, updatedAt: at });
    return { orderFound: true, fullRefundOfSubscription: false, providerSubscriptionId: null };
  }
  await unit.orders.update(order.id, {
    amountRefunded: decision.refundedTotal, status: decision.full ? "refunded" : "partially_refunded",
    refundedAt: at, metadata: decision.metadata, updatedAt: at,
  });
  if (decision.creditsToRevoke > 0 && (order.userId || order.organizationId)) {
    await revokeIn(rt, unit, {
      userId: order.userId, organizationId: order.organizationId, amount: decision.creditsToRevoke,
      bucket: order.orderType === "one_time" ? "purchased" : "subscription", orderId: order.id,
      note: `Refund of ${decision.refundDelta} ${order.currency.toUpperCase()} (order ${order.id})`,
    });
  }
  if (decision.stopDrip && order.providerSubscriptionId) {
    await unit.subscriptions.update(input.provider, order.providerSubscriptionId, { remainingGrants: 0, nextGrantAt: null, updatedAt: at });
    return { orderFound: true, fullRefundOfSubscription: true, providerSubscriptionId: order.providerSubscriptionId };
  }
  return { orderFound: true, fullRefundOfSubscription: false, providerSubscriptionId: null };
}

export async function spendSettledIn(rt: CommerceRuntime, unit: CommerceUnit, params: { userId: string; organizationId?: string | null; amount: number; note: string }) {
  await settleDueIn(rt, unit, params);
  const { spendIn } = await import("./credits.js");
  return spendIn(rt, unit, params);
}

export type { SubscriptionRow };
