import type { CommerceRuntime } from "./context.js";
import { DuplicateRefundFailedError, PermanentFulfillmentError } from "./errors.js";
import { safeUnknownError } from "./privacy.js";
import type { PaymentProvider, SubscriptionRef } from "./types.js";

const DAY = 24 * 60 * 60;

export async function settleDuplicate(rt: CommerceRuntime, params: {
  provider: PaymentProvider; providerSubscriptionId: string; providerOrderId: string;
  winner: SubscriptionRef; amountTotal: number; currency: string; userId: string | null;
  refund?: () => Promise<void>;
}): Promise<void> {
  if (rt.deps.cancelSubscription) {
    await rt.deps.cancelSubscription(params.provider, params.providerSubscriptionId, "Duplicate subscription — an earlier subscription already covers this subject");
  }
  const notify = (refunded: boolean) => rt.deps.notifier?.onDuplicateSubscription?.({
    provider: params.provider, providerSubscriptionId: params.providerSubscriptionId, providerOrderId: params.providerOrderId,
    winnerProvider: params.winner.provider, winnerProviderSubscriptionId: params.winner.providerSubscriptionId,
    amountTotal: params.amountTotal, currency: params.currency, userId: params.userId ?? "(unknown)", refunded,
  });
  const shouldAlert = async (outcome: "refunded" | "manual") => {
    if (!rt.deps.dedupe) return true;
    try {
      return await rt.deps.dedupe.claim(`${rt.deps.productId}:duplicate:${params.provider}:${params.providerOrderId}:${outcome}`, DAY);
    } catch (error) {
      rt.log("error", { err: safeUnknownError(error) }, "Duplicate alert dedupe failed open");
      return true;
    }
  };
  if (!params.refund) {
    if (await shouldAlert("manual")) await notify(false);
    return;
  }
  let refundError: unknown = null;
  if (params.amountTotal > 0) {
    try { await params.refund(); } catch (error) { refundError = error; }
  }
  if (refundError === null) {
    if (await shouldAlert("refunded")) await notify(true);
    return;
  }
  rt.log("error", { provider: params.provider, providerOrderId: params.providerOrderId, err: safeUnknownError(refundError) }, "Failed to auto-refund duplicate provider payment");
  if (await shouldAlert("manual")) await notify(false);
  if (refundError instanceof PermanentFulfillmentError || (refundError instanceof Error && refundError.name === "PermanentFulfillmentError")) throw refundError;
  throw new DuplicateRefundFailedError(params.provider, params.providerOrderId, refundError);
}
