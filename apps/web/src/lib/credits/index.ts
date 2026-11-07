/**
 * Public credits facade.
 *
 * Reads, drip settlement, and the settled spend path use the lazy app
 * singleton in production. createCredits() closes over one explicit app
 * commerce instance for tests and route factories. Ledger writes are
 * re-exported unchanged.
 */

import { ENTITLED_SUBSCRIPTION_STATUSES, addMonthsClamped } from "@sunpcm/niu-commerce";
import { getAppCommerce, type AppCommerce } from "@/composition/commerce";

export * from "./ledger";
export { ENTITLED_SUBSCRIPTION_STATUSES, addMonthsClamped };

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

export interface CreditSubject {
  userId: string | null;
  organizationId?: string | null;
}

export function createCredits(app: AppCommerce) {
  const commerce = app.commerce;
  return {
    settleDripForSubscription(subscriptionId: string): Promise<boolean> {
      return commerce.settleDripForSubscription(subscriptionId);
    },
    settleDueDripGrants(subject: CreditSubject): Promise<void> {
      return commerce.settleDueDripGrants(subject);
    },
    settleDueDripGrantsBatch(limit: number) {
      return commerce.settleDueDripGrantsBatch(limit);
    },
    spendCredits(params: Parameters<AppCommerce["commerce"]["spendCredits"]>[0]) {
      return commerce.spendCredits(params);
    },
    getUserCredits(userId: string) {
      return commerce.getUserCredits(userId);
    },
    getOrganizationCredits(organizationId: string) {
      return commerce.getOrganizationCredits(organizationId);
    },
    hasEntitledSubscription(userId: string) {
      return commerce.hasEntitledSubscription(userId);
    },
    getUserBillingSummary(userId: string) {
      return commerce.getUserBillingSummary(userId);
    },
    getOrganizationBillingSummary(organizationId: string) {
      return commerce.getOrganizationBillingSummary(organizationId);
    },
  };
}

export type Credits = ReturnType<typeof createCredits>;

async function defaultCredits(): Promise<Credits> {
  return createCredits(await getAppCommerce());
}

export function settleDripForSubscription(subscriptionId: string): Promise<boolean> {
  return defaultCredits().then((credits) => credits.settleDripForSubscription(subscriptionId));
}

export function settleDueDripGrants(subject: CreditSubject): Promise<void> {
  return defaultCredits().then((credits) => credits.settleDueDripGrants(subject));
}

export function settleDueDripGrantsBatch(limit: number) {
  return defaultCredits().then((credits) => credits.settleDueDripGrantsBatch(limit));
}

export function spendCredits(params: Parameters<AppCommerce["commerce"]["spendCredits"]>[0]) {
  return defaultCredits().then((credits) => credits.spendCredits(params));
}

export function getUserCredits(userId: string) {
  return defaultCredits().then((credits) => credits.getUserCredits(userId));
}

export function getOrganizationCredits(organizationId: string) {
  return defaultCredits().then((credits) => credits.getOrganizationCredits(organizationId));
}

export function hasEntitledSubscription(userId: string) {
  return defaultCredits().then((credits) => credits.hasEntitledSubscription(userId));
}

export function getUserBillingSummary(userId: string) {
  return defaultCredits().then((credits) => credits.getUserBillingSummary(userId));
}

export function getOrganizationBillingSummary(organizationId: string) {
  return defaultCredits().then((credits) => credits.getOrganizationBillingSummary(organizationId));
}
