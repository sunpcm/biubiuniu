/**
 * [INPUT]: Depends on ./cancel for cancelProviderSubscription, ./types for
 *          SubscriptionRef, @/lib/discord/notifications for
 *          notifyDuplicateSubscription, @/lib/redis for setNx (alert dedup)
 *          and @/lib/redis/redis-keys, @/config/pricing for PaymentProvider,
 *          @/lib/logger for sanitized failure diagnostics
 * [OUTPUT]: Exports settleDuplicateSubscription, DuplicateRefundFailedError
 * [POS]: The duplicate-subscription settlement funnel of lib/billing — once
 *        the core (fulfillment) has ruled "first order recorded wins" inside
 *        the lock, it hands the loser here: provider-side cancel -> auto
 *        refund -> Discord alert. The policy is written once; the three
 *        adapters only inject their own refund closure. A failed refund throws
 *        so the webhook 5xxs -> the provider retries -> the core's replay
 *        restates the duplicate -> this function re-enters -> the refund is
 *        retried, until it succeeds or a human steps in; alerts are deduped
 *        per (provider, providerOrderId) via Redis SETNX, so retries never
 *        flood the ops channel
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import type { PaymentProvider } from "@/config/pricing";
import { notifyDuplicateSubscription } from "@/lib/discord/notifications";
import { getLogger } from "@/lib/logger";
import { REDIS_KEYS_CONFIGS } from "@/lib/redis/redis-keys";
import { cancelProviderSubscription } from "./cancel";
import type { SubscriptionRef } from "./types";

const logger = getLogger("billing.duplicate");

// ============================================================================
// Duplicate-subscription settlement — why a failed refund must throw, not log
//
// The checkout guard is check-then-act: a stale checkout session can still be
// paid after the user has already bought another subscription. The core
// enforces the single-subscription invariant where the money lands: the loser
// gets a 0-credit order, its local row is set to canceled, and "cancel +
// refund" is handed to the adapter. A failed cancel does not matter (the local
// row is already terminal, so the provider's next renewal cannot get through);
// **a failed refund is money taken that should never have been taken**, and
// swallowing it leaves nothing but a human watching Discord — lose the alert,
// lose the money.
//
// So a failed refund always throws: webhook route 5xx -> the provider retries
// with backoff (Stripe/PayPal both allow roughly a 3-day window) -> the core's
// replay short-circuit restates the duplicate from the duplicate order's
// metadata -> this function re-enters -> refund once more. Convergence relies
// on the **refund closure being idempotent** (see the refund parameter
// contract); the alert is sent once on the first failure only (Redis dedup),
// staying quiet across retries.
//
// A template user wiring up a new provider only has to answer two questions:
//   1. Is there a refund API? No -> omit refund; the alert carries
//      refunded:false and ops refunds by hand, and nothing throws (there is
//      no action to retry).
//   2. Yes -> in the closure, normalize "already fully refunded" into success
//      (a replay must not be read as a failure), and throw
//      PermanentFulfillmentError for errors that can never succeed (e.g. the
//      provider does not recognize the id) so the route acks; rethrow every
//      other error as-is to await a retry.
// ============================================================================

/** Auto-refund of a duplicate subscription failed — thrown to the webhook route for a 5xx retry. */
export class DuplicateRefundFailedError extends Error {
  constructor(
    provider: PaymentProvider,
    providerOrderId: string,
    readonly cause: unknown,
  ) {
    super(
      `Duplicate subscription payment ${provider}/${providerOrderId} could not be auto-refunded — retrying via webhook; refund manually if this persists`,
    );
    this.name = "DuplicateRefundFailedError";
  }
}

/** One alert per outcome per duplicate payment within the TTL (one refunded, one manual). */
const DUPLICATE_ALERT_TTL_S = 24 * 60 * 60;

async function loadAlertRedis(): Promise<typeof import("@/lib/redis").redis | null> {
  try {
    const { redis } = await import("@/lib/redis");
    return redis ?? null;
  } catch {
    return null;
  }
}

async function shouldAlert(
  provider: PaymentProvider,
  providerOrderId: string,
  outcome: "refunded" | "manual",
): Promise<boolean> {
  const redis = await loadAlertRedis();
  if (!redis) return true;
  try {
    return await redis.setNx(
      REDIS_KEYS_CONFIGS.billing.duplicateSubscriptionAlert(provider, providerOrderId, outcome),
      "1",
      DUPLICATE_ALERT_TTL_S,
    );
  } catch {
    // Fail open when Redis is missing or erroring: one alert too many beats one too few.
    return true;
  }
}

/**
 * Settles a subscription payment the core has judged duplicate: provider-side
 * cancel -> auto refund -> alert.
 *
 * @param refund Provider-side refund closure. **Must be idempotent**: replays
 *   (webhook redelivery, the reconcile cron, the success page) call it again —
 *   use the provider's idempotency key, or normalize an "already fully
 *   refunded" error into a successful return. Throw
 *   PermanentFulfillmentError for errors that can never succeed (the route
 *   acks on it instead of entering the retry loop); rethrow every other error
 *   as-is, and this function wraps it into DuplicateRefundFailedError to
 *   trigger a retry. Omitted = the provider has no refund API: alert for
 *   manual handling, no throw.
 */
export async function settleDuplicateSubscription(params: {
  provider: PaymentProvider;
  /** The loser (the subscription judged duplicate here) */
  providerSubscriptionId: string;
  /** Idempotency key of this payment (stripe invoice id / creem transaction id / paypal sale id) */
  providerOrderId: string;
  /** The winner (the sibling subscription recorded first), restated by the core from the in-lock ruling or the duplicate order's metadata */
  winner: SubscriptionRef;
  /** Integer cents; a 0 amount (trial / full discount) has nothing to refund and counts as already refunded */
  amountTotal: number;
  currency: string;
  userId: string | null;
  refund?: () => Promise<void>;
}): Promise<void> {
  const { provider, providerSubscriptionId, providerOrderId, winner } = params;

  // Cancel tolerates "already canceled" and never throws: the local row was
  // set to canceled inside the core's lock, so a failed provider-side cancel
  // only means the next renewal gets rejected by sync — not worth blocking
  // the refund.
  await cancelProviderSubscription(
    provider,
    providerSubscriptionId,
    "Duplicate subscription — an earlier subscription already covers this subject",
  );

  const notify = (refunded: boolean) =>
    notifyDuplicateSubscription({
      provider,
      providerSubscriptionId,
      providerOrderId,
      winnerProvider: winner.provider,
      winnerProviderSubscriptionId: winner.providerSubscriptionId,
      amountTotal: params.amountTotal,
      currency: params.currency,
      userId: params.userId ?? "(unknown)",
      refunded,
    });

  // No refund API (Creem): the only thing left to do is page a human.
  if (!params.refund) {
    if (await shouldAlert(provider, providerOrderId, "manual")) {
      await notify(false);
    }
    return;
  }

  let refundError: unknown = null;
  if (params.amountTotal > 0) {
    try {
      await params.refund();
    } catch (error) {
      refundError = error;
    }
  }

  if (refundError === null) {
    if (await shouldAlert(provider, providerOrderId, "refunded")) {
      await notify(true);
    }
    return;
  }

  logger.error(
    { provider, providerOrderId, err: refundError },
    "Failed to auto-refund duplicate provider payment",
  );
  if (await shouldAlert(provider, providerOrderId, "manual")) {
    await notify(false);
  }

  // Permanent failures are the closure's own ruling, signalled by throwing
  // PermanentFulfillmentError — passed through untouched so the route acks;
  // everything else is wrapped and thrown, so the route 5xxs and waits for
  // the provider's retry.
  if (refundError instanceof Error && refundError.name === "PermanentFulfillmentError") {
    throw refundError;
  }
  throw new DuplicateRefundFailedError(provider, providerOrderId, refundError);
}
