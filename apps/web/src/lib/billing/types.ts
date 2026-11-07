/**
 * [INPUT]: Depends on @/config/pricing for the PaymentProvider type
 * [OUTPUT]: Exports CanonicalSubscriptionStatus /
 *           TERMINAL_SUBSCRIPTION_STATUSES / SubscriptionRef /
 *           BillingSubject / SubscriptionSyncInput / OneTimePaymentInput /
 *           SubscriptionPaymentInput / SubscriptionUpdatePaymentInput /
 *           RefundInput
 * [POS]: Type contract layer of lib/billing — the only data shapes between the
 *        fulfillment core (fulfillment.ts) and the provider adapters
 *        (stripe.ts, later creem/paypal); every amount is integer cents
 *        (provider-native cents), never a float
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import type { PaymentProvider } from '@/config/pricing';

// ============================================================================
// Canonical status — provider adapters normalize their native statuses into
// this set BEFORE anything reaches the database. lib/credits'
// ENTITLED_SUBSCRIPTION_STATUSES / GRANTABLE_STATUSES are subsets of it.
// ============================================================================

export type CanonicalSubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'expired'
  | 'paused';

/**
 * Terminal set — subscription endpoints that are irreversible at all three
 * providers. Once a given provider subscription id is canceled/expired it never
 * comes back to life (re-subscribing = new subscription id = new row), so
 * syncSubscription uses this to reject "resurrection" rewrites from out-of-order
 * webhooks.
 * paused is not in the set: Stripe's paused can return to active.
 */
export const TERMINAL_SUBSCRIPTION_STATUSES: CanonicalSubscriptionStatus[] = [
  'canceled',
  'expired',
];

/**
 * Subscription reference — the (provider, providerSubscriptionId) business key
 * pair. fulfillSubscriptionPayment's duplicate check uses it to name the
 * "first-fulfilled winner": when the same subject already has a live sibling
 * subscription with an order recorded, this payment is judged a duplicate — the
 * core marks this subscription row canceled inside the lock and returns the
 * winner's reference to the adapter, which is responsible for the provider-side
 * cancel + automatic refund + alert (the core never calls a provider API back).
 */
export interface SubscriptionRef {
  provider: PaymentProvider;
  providerSubscriptionId: string;
}

/**
 * Billing subject: an individual (organizationId null) or an organization shared
 * pool (organizationId set, userId degraded to the purchaser). Both can be null
 * at once — meaning "the purchaser deleted their account and there is no
 * organization subject"; each core function handles that per its own semantics
 * (sync proceeds as usual, granting throws, bucket clearing is skipped).
 */
export interface BillingSubject {
  userId: string | null;
  organizationId: string | null;
}

// ----------------------------------------------------------------------------
// Core function inputs — provider adapters build these from webhook payloads.
// ----------------------------------------------------------------------------

/** Subscription status sync (upsert) — never touches the drip counters, those belong to payment fulfillment. */
export interface SubscriptionSyncInput {
  provider: PaymentProvider;
  providerSubscriptionId: string;
  subject: BillingSubject;
  /** Plan slug from config/pricing.ts */
  planId: string;
  providerCustomerId?: string | null;
  /** stripe price id / creem product id / paypal plan id */
  providerPriceId?: string | null;
  status: CanonicalSubscriptionStatus;
  interval: 'month' | 'year';
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: Date | null;
  endedAt?: Date | null;
  /** Credits granted per month (yearly plans drip this amount monthly). */
  monthlyCredits: number;
  metadata?: Record<string, unknown> | null;
}

/** One-time credit pack purchase (order + grant, in one transaction). */
export interface OneTimePaymentInput {
  provider: PaymentProvider;
  /** Idempotency key: composite-unique together with provider (stripe session id / creem order id / paypal capture id). */
  providerOrderId: string;
  /** Refund handle: charge/capture/payment-intent id. */
  providerPaymentId?: string | null;
  subject: BillingSubject;
  planId: string;
  /** Credits granted by this purchase. */
  credits: number;
  amountTotal: number;
  amountSubtotal?: number | null;
  amountDiscount?: number;
  amountTax?: number;
  currency: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Subscription payment fulfillment (initial or renewal): sync the subscription
 * row + idempotent order insert + reset subscription credits + initialize the
 * yearly drip. Proration / plan-change invoices must never enter this function
 * — the caller (the adapter) is responsible for filtering them out (e.g.
 * Stripe's billing_reason check).
 */
export interface SubscriptionPaymentInput {
  /** Full sync state of the subscription this payment belongs to (provider/subject/planId all live in it). */
  subscription: SubscriptionSyncInput;
  orderType: 'subscription_initial' | 'subscription_renewal';
  /** Idempotency key: stripe invoice id / creem transaction id / paypal sale id. */
  providerOrderId: string;
  providerPaymentId?: string | null;
  amountTotal: number;
  amountSubtotal?: number | null;
  amountDiscount?: number;
  amountTax?: number;
  currency: string;
  /** Start of the current period, used to schedule the yearly drip (defaults to now). */
  periodStart?: Date | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Mid-cycle plan-change fulfillment (proration invoice, e.g. Stripe
 * billing_reason=subscription_update): sync the subscription row + idempotent
 * order insert (orderType=subscription_upgrade) + top up the subscription
 * bucket by "watermark delta x remaining-time ratio", never resetting the
 * bucket. There is no charged-amount threshold — zero-amount invoices
 * (downgrades / upgrades covered by credit balance) come through as usual, and
 * the core decides the grant amount on its own.
 */
export interface SubscriptionUpdatePaymentInput {
  /** Full sync state of the subscription this payment belongs to (provider/subject/planId all live in it). */
  subscription: SubscriptionSyncInput;
  /** Idempotency key: composite-unique together with provider (stripe invoice id). */
  providerOrderId: string;
  providerPaymentId?: string | null;
  amountTotal: number;
  amountSubtotal?: number | null;
  amountDiscount?: number;
  amountTax?: number;
  currency: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Refund: locate the original order (by providerOrderId first, then by
 * providerPaymentId). An official cumulative total advances the watermark.
 * A single event amount is accepted only with a stable refund id and is summed
 * from the persisted ledger; it is never treated as the running total.
 */
export interface RefundInput {
  provider: PaymentProvider;
  providerOrderId?: string | null;
  providerPaymentId?: string | null;
  /**
   * Integer cents. When `cumulative` is not false this is the provider's
   * official running total. When `cumulative` is false it is only this
   * event's own amount and `refundId` is required.
   */
  amountRefunded: number;
  /** Default true so existing official-total callers keep watermark semantics. */
  cumulative?: boolean;
  /** Stable provider refund id. Required for a non-cumulative event amount. */
  refundId?: string | null;
}
