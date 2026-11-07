import type { CommerceRuntime } from "./context.js";
import { safeUnknownError } from "./privacy.js";

const DAY = 24 * 60 * 60;

async function claim(rt: CommerceRuntime, key: string): Promise<boolean> {
  if (!rt.deps.dedupe) return true;
  try { return await rt.deps.dedupe.claim(key, DAY); }
  catch (error) {
    rt.log("error", { err: safeUnknownError(error) }, "Billing alert dedupe is unavailable");
    return true;
  }
}

export async function notifyCreditGrantFailed(rt: CommerceRuntime, params: { userId: string; orderId: string; planId: string; error: unknown }): Promise<void> {
  const safe = safeUnknownError(params.error);
  const first = await claim(rt, `${rt.deps.productId}:credit-grant-failed:${params.orderId}`);
  if (!first) {
    rt.log("error", { orderId: params.orderId, err: safe }, "Credit grant failed (alert already sent, deduped)");
    return;
  }
  try {
    await rt.deps.notifier?.onCreditGrantFailed?.({ userId: params.userId, orderId: params.orderId, planId: params.planId, errorMessage: safe.message, errorStack: safe.stack });
  } catch (error) {
    rt.log("error", { err: safeUnknownError(error) }, "Failed to send credit-grant-failed notification");
  }
}

export async function notifyInvoicePaymentFailed(rt: CommerceRuntime, params: Record<string, unknown> & { userId: string }): Promise<void> {
  const admin = rt.deps.admin?.email;
  if (!admin || !rt.deps.mailer) return;
  try {
    const email = await rt.withUnit(undefined, (unit) => unit.identity.findUserEmail(params.userId));
    if (!email) return;
    const props = { ...params, siteName: rt.deps.admin?.siteName ?? null, billingUrl: rt.deps.admin?.billingUrl ?? null, supportUrl: rt.deps.admin?.supportUrl ?? null };
    await rt.deps.mailer.send({
      to: email,
      from: { email: admin, name: rt.deps.admin?.name ?? rt.deps.admin?.siteName ?? undefined },
      subject: "Action required: a subscription payment failed",
      template: "invoice-payment-failed",
      props,
    });
  } catch (error) {
    rt.log("error", { err: safeUnknownError(error) }, "Failed to send invoice-payment-failed email");
  }
}
