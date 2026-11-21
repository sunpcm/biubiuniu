# lib/billing/

> L2 | Parent: /CLAUDE.md

The only place provider money events become orders, subscription rows and credits. Two layers: a provider-agnostic core (types + fulfillment) and one adapter per provider.

Files

- types.ts: Type contracts — CanonicalSubscriptionStatus, TERMINAL_SUBSCRIPTION_STATUSES, SubscriptionRef, BillingSubject, and the sync / one-time / subscription / upgrade / refund input shapes. Amounts are integer cents.
- fulfillment.ts: Provider-agnostic core — fulfillOneTimePurchase, recordPendingOneTimePurchase, fulfillSubscriptionPayment, fulfillSubscriptionUpgrade, syncSubscription, handleSubscriptionEnded, applyRefund, subject resolution helpers, and PermanentFulfillmentError.
- stripe.ts: Stripe adapter — status mapping, user resolution, checkout and invoice fulfillment, subscription sync, refunds, payment-failure mail, Radar early fraud warnings.
- creem.ts: Creem adapter — status mapping, subject resolution, checkout and subscription-paid fulfillment, subscription sync, cron reconciliation, refunds, disputes. Sole writer of user.creemCustomerId.
- paypal.ts: PayPal adapter — decimal-to-cents conversion, status mapping, capture and sale fulfillment, pending-capture records and denials, subscription sync from source, refunds and reversals. Sole writer of user.paypalPayerId.
- cancel.ts: cancelProviderSubscription — the single provider-side cancel implementation, tolerating "already cancelled" across all three providers.
- duplicate.ts: settleDuplicateSubscription — cancels the losing subscription, calls the adapter-supplied refund closure, and alerts (Redis-deduped); a failed refund throws so the provider retries.
- customer.ts: getOrCreateStripeCustomer — the only reader/writer of user.stripeCustomerId, self-healing on a stale id.
- reconcile.ts: Cron-driven recovery for lost webhooks — reconcileOverdueRenewals (Stripe, Creem, and PayPal subscription transactions) and reconcilePendingPayPalCaptures (promotes or fails pending captures).
- notify.ts: Webhook-triggered notifications (grant failure to admins, renewal failure to users, fraud alerts), all fire-and-safe with Redis dedup.

Design rules

- No SDK types in the core: webhook payloads are translated to core inputs inside the adapters only.
- Idempotency is structural, not defensive: unique constraints + onConflictDoNothing + cumulative refund totals.
- Credits are granted only once money settles; cron guarantees delivery, not occurrence.
- `create*Billing(app)` factories close over one explicit app instance. Handlers capture their factory at construction; historical exported functions remain thin lazy wrappers over the production `getAppCommerce()` singleton.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
