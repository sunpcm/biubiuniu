# actions/billing/
> L2 | Parent: /CLAUDE.md

Checkout and portal entry points. Guards run first (auth, subject resolution, single-subscription), provider dispatch last.

Files
- checkout.ts: createCheckoutSession({ planId, organizationId?, toltReferral? }) — unified checkout entry, dispatches to Stripe Checkout / Creem Checkout / PayPal subscription approval by the plan's provider.
- portal.ts: createCustomerPortalSession() — finds the live subscription for the current workspace and opens the matching provider portal (Stripe Billing Portal / Creem Customer Portal / PayPal autopay page).

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
