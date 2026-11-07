# actions/paypal/
> L2 | Parent: /CLAUDE.md

PayPal has no hosted customer portal, so cancelling a subscription must go through the API — that is the only action kept here. Portal semantics live in actions/billing/portal.ts; payer-id persistence and subscription sync belong to the lib/billing/paypal adapter.

Files
- index.ts: cancelPayPalSubscriptionAction(subscriptionId, reason?) — auth + ownership check, cancel, then re-sync from PayPal so the UI reflects it immediately.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
