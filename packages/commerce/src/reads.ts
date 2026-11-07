import type { CommerceRuntime } from "./context.js";
import { settleDueApart } from "./drip.js";
import { ENTITLED_SUBSCRIPTION_STATUSES, type BillingSubject } from "./types.js";

export interface UserCredits {
  subscriptionCredits: number;
  purchasedCredits: number;
  totalCredits: number;
}

export interface BillingSummary extends UserCredits {
  subscription: {
    planId: string;
    status: string;
    interval: "month" | "year";
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    nextGrantAt: Date | null;
    monthlyCredits: number;
  } | null;
}

async function creditsOf(rt: CommerceRuntime, subject: { userId?: string; organizationId?: string }): Promise<UserCredits> {
  await settleDueApart(rt, { userId: subject.userId ?? null, organizationId: subject.organizationId ?? null });
  const row = await rt.withUnit(undefined, (unit) => unit.balances.read({ userId: subject.userId ?? null, organizationId: subject.organizationId ?? null }));
  return {
    subscriptionCredits: row.subscription,
    purchasedCredits: row.purchased,
    totalCredits: row.subscription + row.purchased,
  };
}

export function getUserCredits(rt: CommerceRuntime, userId: string): Promise<UserCredits> {
  return creditsOf(rt, { userId });
}

export function getOrganizationCredits(rt: CommerceRuntime, organizationId: string): Promise<UserCredits> {
  return creditsOf(rt, { organizationId });
}

export function hasEntitledSubscription(rt: CommerceRuntime, userId: string): Promise<boolean> {
  return rt.withUnit(undefined, (unit) => unit.subscriptions.hasEntitledForUser(userId, ENTITLED_SUBSCRIPTION_STATUSES));
}

async function summary(rt: CommerceRuntime, subject: BillingSubject, credits: UserCredits): Promise<BillingSummary> {
  const sub = await rt.withUnit(undefined, (unit) => unit.subscriptions.findLatestEntitled(subject, ENTITLED_SUBSCRIPTION_STATUSES));
  return {
    ...credits,
    subscription: sub ? {
      planId: sub.planId, status: sub.status, interval: sub.interval, currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd, nextGrantAt: sub.nextGrantAt, monthlyCredits: sub.monthlyCredits,
    } : null,
  };
}

export async function getUserBillingSummary(rt: CommerceRuntime, userId: string): Promise<BillingSummary> {
  return summary(rt, { userId, organizationId: null }, await getUserCredits(rt, userId));
}

export async function getOrganizationBillingSummary(rt: CommerceRuntime, organizationId: string): Promise<BillingSummary> {
  return summary(rt, { userId: null, organizationId }, await getOrganizationCredits(rt, organizationId));
}
