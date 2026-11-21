/** PayPal persisted source binding wrapper. */

import { getAppCommerce, type AppCommerce } from "@/composition/commerce";

export interface PayPalSourceBinding {
  orderId: string;
  userId: string;
  organizationId: string | null;
  planId: string;
  amountTotal: number;
  currency: string;
}

export function createPayPalSourceBilling(app: AppCommerce) {
  const commerce = app.commerce;
  return {
    recordPayPalSourceBinding(binding: PayPalSourceBinding) {
      return commerce.recordPayPalSourceBinding(binding);
    },
    resolvePayPalSourceBinding(orderId?: string | null, captureId?: string | null) {
      return commerce.resolvePayPalSourceBinding(orderId, captureId);
    },
    attachPendingPayPalCapture(
      rowId: string,
      captureId: string,
      metadata: Record<string, unknown>,
    ) {
      return commerce.attachPendingPayPalCapture(rowId, captureId, metadata);
    },
  };
}

export type PayPalSourceBilling = ReturnType<typeof createPayPalSourceBilling>;

async function defaultBilling(): Promise<PayPalSourceBilling> {
  return createPayPalSourceBilling(await getAppCommerce());
}

export function recordPayPalSourceBinding(binding: PayPalSourceBinding) {
  return defaultBilling().then((billing) => billing.recordPayPalSourceBinding(binding));
}

export function resolvePayPalSourceBinding(orderId?: string | null, captureId?: string | null) {
  return defaultBilling().then((billing) => billing.resolvePayPalSourceBinding(orderId, captureId));
}

export function attachPendingPayPalCapture(
  rowId: string,
  captureId: string,
  metadata: Record<string, unknown>,
) {
  return defaultBilling().then((billing) =>
    billing.attachPendingPayPalCapture(rowId, captureId, metadata),
  );
}
