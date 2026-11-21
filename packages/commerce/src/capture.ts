import type { CommerceRuntime } from "./context.js";
import { PermanentFulfillmentError } from "./errors.js";
import { paypalAmountToMinor } from "./money.js";
import { assertBoundMetadata } from "./source.js";
import type { OrderRow } from "./store.js";

export interface PayPalCustomIdData {
  userId: string;
  planId: string;
  submitProductId?: string | null;
  organizationId?: string | null;
}

export function encodePayPalCustomId(data: PayPalCustomIdData): string {
  return [data.userId, data.planId, data.submitProductId || "", data.organizationId || ""].join("|");
}

export function decodePayPalCustomId(customId: string | undefined | null): (PayPalCustomIdData & { organizationId: string | null }) | null {
  if (!customId) return null;
  const parts = customId.split("|");
  if (parts.length < 2) return null;
  return { userId: parts[0]!, planId: parts[1]!, submitProductId: parts[2] || null, organizationId: parts[3] || null };
}

export async function authorizeInteractiveCapture(rt: CommerceRuntime, input: { organizationId?: string | null }): Promise<{ userId: string; organizationId: string | null }> {
  const principal = await rt.deps.identity.getFreshPrincipal();
  if (!principal || principal.revoked || principal.banned) {
    throw new PermanentFulfillmentError("Interactive capture rejected before the provider is called");
  }
  const organizationId = input.organizationId ?? null;
  if (organizationId) {
    const live = await rt.deps.identity.isLiveMember(principal.userId, organizationId);
    if (!live) throw new PermanentFulfillmentError("Interactive capture rejected: organization membership is not live");
  }
  return { userId: principal.userId, organizationId };
}

export function assertNewPurchaseOpen(rt: CommerceRuntime): void {
  if (rt.deps.purchasesEnabled === false) {
    throw new PermanentFulfillmentError("New purchases are closed");
  }
}

export async function recordPayPalSourceBinding(rt: CommerceRuntime, binding: {
  orderId: string; userId: string; organizationId: string | null; planId: string; amountTotal: number; currency: string;
}): Promise<void> {
  assertNewPurchaseOpen(rt);
  if (!binding.orderId || !binding.userId || !binding.planId || !Number.isSafeInteger(binding.amountTotal) || binding.amountTotal <= 0 || binding.amountTotal > 2147483647 || !/^[a-z]{3}$/i.test(binding.currency)) {
    throw new Error("Invalid PayPal checkout binding");
  }
  const { recordPendingIn } = await import("./fulfillment.js");
  await rt.withUnit(undefined, (unit) => recordPendingIn(rt, unit, {
    provider: "paypal", providerOrderId: binding.orderId,
    subject: { userId: binding.userId, organizationId: binding.organizationId },
    planId: binding.planId, credits: 0, amountTotal: binding.amountTotal, currency: binding.currency.toLowerCase(),
    metadata: { paypalOrderId: binding.orderId, paypalSourceVersion: 1 },
  }));
}

export async function resolvePayPalSourceBinding(rt: CommerceRuntime, orderId?: string | null, captureId?: string | null): Promise<OrderRow | null> {
  return rt.withUnit(undefined, async (unit) => {
    const rows = await unit.orders.listPayPalBindings(orderId, captureId);
    if (rows.length > 1) throw new Error("Ambiguous PayPal order/capture binding");
    const row = rows[0];
    if (!row) return null;
    if ((!row.userId && !row.organizationId) || row.amountTotal <= 0) throw new Error("Unowned or invalid PayPal order binding");
    const pinned = typeof row.metadata?.paypalOrderId === "string" ? row.metadata.paypalOrderId : null;
    if (orderId && orderId !== row.providerOrderId && orderId !== pinned) throw new Error("PayPal external order reference conflict");
    if (captureId && row.providerPaymentId && row.providerPaymentId !== captureId) throw new Error("PayPal capture reference conflict");
    return row;
  });
}

export async function attachPendingPayPalCapture(rt: CommerceRuntime, rowId: string, captureId: string, metadata: Record<string, unknown>): Promise<void> {
  await rt.withUnit(undefined, async (unit) => {
    const row = await unit.orders.lockById(rowId);
    if (!row || row.provider !== "paypal") throw new Error("PayPal binding disappeared");
    if (row.providerPaymentId && row.providerPaymentId !== captureId) throw new Error("PayPal capture reference conflict");
    if (row.status !== "pending") return;
    await unit.orders.update(row.id, {
      providerPaymentId: captureId,
      metadata: { ...(row.metadata ?? {}), ...metadata, paypalCaptureId: captureId },
      updatedAt: rt.deps.clock.now(),
    });
  });
}

export async function boundPayPalCapture(rt: CommerceRuntime, params: {
  captureId: string; customId?: string | null; sourceOrderId?: string | null; amountValue?: string | null; currencyCode?: string | null;
}) {
  const decoded = decodePayPalCustomId(params.customId);
  const bound = await resolvePayPalSourceBinding(rt, params.sourceOrderId, params.captureId);
  if (!bound) throw new Error(`No verified PayPal order binding for capture ${params.captureId}`);
  if (params.customId && !decoded) throw new Error("Malformed PayPal custom_id");
  if (decoded) {
    assertBoundMetadata(bound, decoded);
    if (decoded.organizationId !== bound.organizationId) throw new Error("PayPal organization binding conflict");
  }
  const plan = rt.catalog.getPlanById(bound.planId);
  if (!plan || plan.provider !== "paypal" || plan.kind !== "credit_pack") throw new Error("PayPal binding does not identify a credit pack");
  if (paypalAmountToMinor(params.amountValue) !== bound.amountTotal || params.currencyCode?.toLowerCase() !== bound.currency.toLowerCase()) {
    throw new Error("PayPal capture money conflicts with checkout binding");
  }
  return { bound, plan, decoded };
}
