import { assertBucket, assertCreditAmount } from "./money.js";
import { InsufficientCreditsError } from "./errors.js";
import type { CommerceRuntime } from "./context.js";
import type { CommerceUnit } from "./store.js";
import type { CreditBuckets, CreditSubject, CreditTransactionType } from "./types.js";

export interface SpendResult {
  buckets: CreditBuckets;
  txId: string;
  spentFromSubscription: number;
  spentFromPurchased: number;
}

export type CreditBucket = "subscription" | "purchased";

/** Admin single-bucket credit operation, all required except optional target org. */
export interface AdminCreditParams {
  userId: string;
  bucket: CreditBucket;
  amount: number;
  /** Trusted server-resolved operator user ID; never caller-declared or an email. */
  actorUserId: string;
  reason: string;
}

const MAX_ADMIN_REASON_LENGTH = 500;

function assertRequiredId(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
}

/**
 * Runtime guard for the public admin single-bucket API. The TypeScript
 * `CreditBucket` union is erased at runtime; a JavaScript caller can pass an
 * array, object, null, undefined or an unknown string and JS property-key
 * coercion would otherwise route it into a real bucket. This must run before
 * any balance/ledger write so a malformed bucket is a hard error with zero
 * storage side effects, never a silently coerced write.
 */
export function assertAdminBucket(bucket: CreditBucket): void {
  if (bucket !== "subscription" && bucket !== "purchased") {
    throw new Error('bucket must be "subscription" or "purchased"');
  }
}

function assertAdminReason(reason: string): void {
  assertRequiredId(reason, "reason");
  if (reason.length > MAX_ADMIN_REASON_LENGTH) {
    throw new Error(`reason exceeds ${MAX_ADMIN_REASON_LENGTH} characters`);
  }
}

function adminNote(
  action: "add" | "set" | "deduct",
  bucket: CreditBucket,
  actorUserId: string,
  reason: string,
): string {
  return `[admin:${action}:${bucket}] actor=${actorUserId} ${reason}`;
}

function subjectOf(subject: CreditSubject): { userId: string | null; organizationId: string | null } {
  return { userId: subject.userId, organizationId: subject.organizationId ?? null };
}

async function mutate(
  rt: CommerceRuntime,
  unit: CommerceUnit,
  ctx: {
    userId: string | null;
    organizationId?: string | null;
    type: CreditTransactionType;
    note?: string | null;
    orderId?: string | null;
    refundedTransactionId?: string | null;
  },
  transition: (current: CreditBuckets) => CreditBuckets | null,
): Promise<{ buckets: CreditBuckets; txId: string | null }> {
  const subject = subjectOf(ctx);
  const current = await unit.balances.lock(subject);
  const next = transition(current);
  if (next === null) return { buckets: current, txId: null };
  assertBucket(next);
  await unit.balances.write(subject, next, rt.deps.clock.now());
  const journal = await unit.ledger.append({
    userId: ctx.userId,
    organizationId: subject.organizationId,
    type: ctx.type,
    amount: next.subscription + next.purchased - current.subscription - current.purchased,
    subscriptionDelta: next.subscription - current.subscription,
    purchasedDelta: next.purchased - current.purchased,
    subscriptionCreditsAfter: next.subscription,
    purchasedCreditsAfter: next.purchased,
    note: ctx.note ?? null,
    orderId: ctx.orderId ?? null,
    refundedTransactionId: ctx.refundedTransactionId ?? null,
    createdAt: rt.deps.clock.now(),
  });
  return { buckets: next, txId: journal.id };
}

export async function grantPurchasedIn(rt: CommerceRuntime, unit: CommerceUnit, params: {
  userId: string | null; organizationId?: string | null; amount: number; orderId?: string; note?: string;
}): Promise<CreditBuckets> {
  assertCreditAmount(params.amount, { allowZero: true });
  const { buckets } = await mutate(rt, unit, { ...params, type: "purchase" }, (b) => ({
    subscription: b.subscription, purchased: b.purchased + params.amount,
  }));
  return buckets;
}

export async function resetSubscriptionIn(rt: CommerceRuntime, unit: CommerceUnit, params: {
  userId: string | null; organizationId?: string | null; amount: number; orderId?: string; note?: string;
}): Promise<CreditBuckets> {
  assertCreditAmount(params.amount, { allowZero: true });
  await mutate(rt, unit, {
    ...params, type: "subscription_cycle_expire", note: "Unused subscription credits expired on new grant",
  }, (b) => b.subscription === 0 ? null : { subscription: 0, purchased: b.purchased });
  const { buckets } = await mutate(rt, unit, { ...params, type: "subscription_grant" }, (b) => ({
    subscription: params.amount, purchased: b.purchased,
  }));
  return buckets;
}

export async function grantUpgradeIn(rt: CommerceRuntime, unit: CommerceUnit, params: {
  userId: string | null; organizationId?: string | null; amount: number; orderId?: string; note?: string;
}): Promise<CreditBuckets> {
  assertCreditAmount(params.amount, { allowNegative: true, allowZero: true });
  const { buckets } = await mutate(rt, unit, { ...params, type: "subscription_grant" }, (b) => (
    params.amount <= 0 ? null : { subscription: b.subscription + params.amount, purchased: b.purchased }
  ));
  return buckets;
}

export async function spendIn(rt: CommerceRuntime, unit: CommerceUnit, params: {
  userId: string; organizationId?: string | null; amount: number; note: string;
}): Promise<SpendResult> {
  assertCreditAmount(params.amount, { allowZero: false });
  let fromSubscription = 0;
  const { buckets, txId } = await mutate(rt, unit, { ...params, type: "usage" }, (b) => {
    const total = b.subscription + b.purchased;
    if (total < params.amount) throw new InsufficientCreditsError(params.amount, total);
    fromSubscription = Math.min(b.subscription, params.amount);
    return {
      subscription: b.subscription - fromSubscription,
      purchased: b.purchased - (params.amount - fromSubscription),
    };
  });
  return {
    buckets,
    txId: txId!,
    spentFromSubscription: fromSubscription,
    spentFromPurchased: params.amount - fromSubscription,
  };
}

export async function refundSpentIn(rt: CommerceRuntime, unit: CommerceUnit, params: {
  userId?: string | null; spendTxId: string; note?: string;
}): Promise<CreditBuckets> {
  const spend = await unit.ledger.findUsage(params.spendTxId);
  if (!spend) throw new Error(`refundSpentCredits: no usage transaction ${params.spendTxId}`);
  if (params.userId && spend.userId && spend.userId !== params.userId) {
    throw new Error(`refundSpentCredits: usage transaction ${params.spendTxId} does not belong to user ${params.userId}`);
  }
  const subject = { userId: spend.userId ?? params.userId ?? null, organizationId: spend.organizationId };
  if (!subject.userId && !subject.organizationId) return { subscription: 0, purchased: 0 };
  const balance = await unit.balances.lock(subject);
  const already = await unit.ledger.findRefundOf(params.spendTxId);
  if (already) return balance;
  const { buckets } = await mutate(rt, unit, {
    ...subject, type: "usage_refund", note: params.note, refundedTransactionId: params.spendTxId,
  }, (b) => ({
    subscription: b.subscription - spend.subscriptionDelta,
    purchased: b.purchased - spend.purchasedDelta,
  }));
  return buckets;
}

export async function revokeIn(rt: CommerceRuntime, unit: CommerceUnit, params: {
  userId: string | null; organizationId?: string | null; amount: number;
  bucket: "subscription" | "purchased"; orderId?: string; note?: string;
}): Promise<CreditBuckets> {
  assertCreditAmount(params.amount, { allowZero: true });
  const { buckets } = await mutate(rt, unit, { ...params, type: "refund_revoke" }, (b) => {
    const next = { ...b };
    next[params.bucket] = Math.max(0, b[params.bucket] - params.amount);
    return next[params.bucket] === b[params.bucket] ? null : next;
  });
  return buckets;
}

export async function clearSubscriptionIn(rt: CommerceRuntime, unit: CommerceUnit, params: {
  userId: string | null; organizationId?: string | null; note?: string;
}): Promise<CreditBuckets> {
  const { buckets } = await mutate(rt, unit, { ...params, type: "subscription_end_revoke" }, (b) => (
    b.subscription === 0 ? null : { subscription: 0, purchased: b.purchased }
  ));
  return buckets;
}

export async function signupBonusIn(rt: CommerceRuntime, unit: CommerceUnit, params: {
  userId: string; amount: number; note?: string;
}): Promise<CreditBuckets> {
  assertCreditAmount(params.amount, { allowZero: true });
  const locked = await unit.balances.lock({ userId: params.userId });
  if (await unit.ledger.hasSignupBonus(params.userId)) return locked;
  const { buckets } = await mutate(rt, unit, { userId: params.userId, type: "signup_bonus", note: params.note }, (b) => ({
    subscription: b.subscription, purchased: b.purchased + params.amount,
  }));
  return buckets;
}

export async function adjustIn(rt: CommerceRuntime, unit: CommerceUnit, params: {
  userId: string; organizationId?: string | null; delta: number; note: string;
}): Promise<CreditBuckets> {
  assertCreditAmount(params.delta, { allowNegative: true, allowZero: true });
  const { buckets } = await mutate(rt, unit, { ...params, type: "admin_adjustment" }, (b) => {
    if (params.delta === 0) return null;
    if (params.delta > 0) return { subscription: b.subscription, purchased: b.purchased + params.delta };
    const toRemove = Math.min(-params.delta, b.subscription + b.purchased);
    const fromPurchased = Math.min(b.purchased, toRemove);
    return {
      subscription: b.subscription - (toRemove - fromPurchased),
      purchased: b.purchased - fromPurchased,
    };
  });
  return buckets;
}

export async function addCreditsIn(
  rt: CommerceRuntime,
  unit: CommerceUnit,
  params: AdminCreditParams,
): Promise<CreditBuckets> {
  assertAdminBucket(params.bucket);
  assertCreditAmount(params.amount, { allowZero: true });
  assertRequiredId(params.userId, "userId");
  assertRequiredId(params.actorUserId, "actorUserId");
  assertAdminReason(params.reason);
  const { buckets } = await mutate(
    rt,
    unit,
    {
      userId: params.userId,
      type: "admin_adjustment",
      note: adminNote("add", params.bucket, params.actorUserId, params.reason),
    },
    (b) =>
      params.amount === 0
        ? null
        : { ...b, [params.bucket]: b[params.bucket] + params.amount },
  );
  return buckets;
}

export async function setCreditsIn(
  rt: CommerceRuntime,
  unit: CommerceUnit,
  params: AdminCreditParams,
): Promise<CreditBuckets> {
  assertAdminBucket(params.bucket);
  assertCreditAmount(params.amount, { allowZero: true });
  assertRequiredId(params.userId, "userId");
  assertRequiredId(params.actorUserId, "actorUserId");
  assertAdminReason(params.reason);
  const { buckets } = await mutate(
    rt,
    unit,
    {
      userId: params.userId,
      type: "admin_adjustment",
      note: adminNote("set", params.bucket, params.actorUserId, params.reason),
    },
    (b) =>
      b[params.bucket] === params.amount
        ? null
        : { ...b, [params.bucket]: params.amount },
  );
  return buckets;
}

export async function deductCreditsIn(
  rt: CommerceRuntime,
  unit: CommerceUnit,
  params: AdminCreditParams,
): Promise<CreditBuckets> {
  assertAdminBucket(params.bucket);
  assertCreditAmount(params.amount, { allowZero: true });
  assertRequiredId(params.userId, "userId");
  assertRequiredId(params.actorUserId, "actorUserId");
  assertAdminReason(params.reason);
  const { buckets } = await mutate(
    rt,
    unit,
    {
      userId: params.userId,
      type: "admin_adjustment",
      note: adminNote("deduct", params.bucket, params.actorUserId, params.reason),
    },
    (b) => {
      const next = Math.max(0, b[params.bucket] - params.amount);
      return next === b[params.bucket] ? null : { ...b, [params.bucket]: next };
    },
  );
  return buckets;
}
