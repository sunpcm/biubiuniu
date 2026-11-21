/**
 * Provider-neutral fulfillment wrapper.
 *
 * The historical names remain for production callers and delegate to the lazy
 * app singleton. Tests and route factories use createFulfillmentBilling() so
 * every operation stays closed over one explicit app commerce instance.
 */

import { PermanentFulfillmentError, RefundHistoryIncompleteError } from "@sunpcm/niu-commerce";
import { getAppCommerce, type AppCommerce } from "@/composition/commerce";
import type {
  OneTimePaymentInput,
  RefundInput,
  SubscriptionPaymentInput,
  SubscriptionSyncInput,
  SubscriptionUpdatePaymentInput,
} from "./types";

export { PermanentFulfillmentError, RefundHistoryIncompleteError };

export interface SubscriptionEndPatch {
  status?: SubscriptionSyncInput["status"];
  canceledAt?: Date | null;
  endedAt?: Date | null;
  cancelAtPeriodEnd?: boolean;
}

export function createFulfillmentBilling(app: AppCommerce) {
  const commerce = app.commerce;
  return {
    resolveValidUserId(candidate: string | null | undefined) {
      return commerce.resolveValidUserId(candidate);
    },
    resolveValidOrganizationId(candidate: string | null | undefined) {
      return commerce.resolveValidOrganizationId(candidate);
    },
    resolveSubject(params: { userId?: string | null; organizationId?: string | null }) {
      return commerce.resolveSubject(params);
    },
    fulfillOneTimePurchase(input: OneTimePaymentInput) {
      return commerce.fulfillOneTimePurchase(input);
    },
    recordPendingOneTimePurchase(input: OneTimePaymentInput) {
      return commerce.recordPendingOneTimePurchase(input);
    },
    syncSubscription(input: SubscriptionSyncInput) {
      return commerce.syncSubscription(input);
    },
    fulfillSubscriptionPayment(input: SubscriptionPaymentInput) {
      return commerce.fulfillSubscriptionPayment(input);
    },
    fulfillSubscriptionUpgrade(input: SubscriptionUpdatePaymentInput) {
      return commerce.fulfillSubscriptionUpgrade(input);
    },
    handleSubscriptionEnded(
      provider: SubscriptionSyncInput["provider"],
      providerSubscriptionId: string,
      patch?: SubscriptionEndPatch,
    ) {
      return commerce.handleSubscriptionEnded(provider, providerSubscriptionId, patch);
    },
    applyRefund(input: RefundInput) {
      return commerce.applyRefund(input);
    },
  };
}

export type FulfillmentBilling = ReturnType<typeof createFulfillmentBilling>;

async function defaultBilling(): Promise<FulfillmentBilling> {
  return createFulfillmentBilling(await getAppCommerce());
}

export function resolveValidUserId(candidate: string | null | undefined) {
  return defaultBilling().then((billing) => billing.resolveValidUserId(candidate));
}

export function resolveValidOrganizationId(candidate: string | null | undefined) {
  return defaultBilling().then((billing) => billing.resolveValidOrganizationId(candidate));
}

export function resolveSubject(params: { userId?: string | null; organizationId?: string | null }) {
  return defaultBilling().then((billing) => billing.resolveSubject(params));
}

export function fulfillOneTimePurchase(input: OneTimePaymentInput) {
  return defaultBilling().then((billing) => billing.fulfillOneTimePurchase(input));
}

export function recordPendingOneTimePurchase(input: OneTimePaymentInput) {
  return defaultBilling().then((billing) => billing.recordPendingOneTimePurchase(input));
}

export function syncSubscription(input: SubscriptionSyncInput) {
  return defaultBilling().then((billing) => billing.syncSubscription(input));
}

export function fulfillSubscriptionPayment(input: SubscriptionPaymentInput) {
  return defaultBilling().then((billing) => billing.fulfillSubscriptionPayment(input));
}

export function fulfillSubscriptionUpgrade(input: SubscriptionUpdatePaymentInput) {
  return defaultBilling().then((billing) => billing.fulfillSubscriptionUpgrade(input));
}

export function handleSubscriptionEnded(
  provider: SubscriptionSyncInput["provider"],
  providerSubscriptionId: string,
  patch?: SubscriptionEndPatch,
) {
  return defaultBilling().then((billing) =>
    billing.handleSubscriptionEnded(provider, providerSubscriptionId, patch),
  );
}

export function applyRefund(input: RefundInput) {
  return defaultBilling().then((billing) => billing.applyRefund(input));
}
