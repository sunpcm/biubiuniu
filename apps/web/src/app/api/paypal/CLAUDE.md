# app/api/paypal/
> L2 | Parent: /CLAUDE.md

Three PayPal HTTP endpoints — the two-hop credit-pack button flow plus the webhook. Business logic lives in the lib/billing/paypal adapter; these routes only authenticate, validate and dispatch. Prices come from config/pricing.ts and are never trusted from the client.

Files
- create-order/route.ts: POST { planId } → validates (signed in, active PayPal credit pack, personal workspace only) → createPayPalOrder → { orderId }.
- capture-order/route.ts: POST { orderId } → capturePayPalOrder → ownership check → dispatch on the capture-level status: COMPLETED fulfills synchronously, PENDING records a pending order row and alerts.
- webhook/route.ts: POST — verifies the signature, then dispatches capture, sale, refund and subscription events to lib/billing/paypal. Failures return 5xx so PayPal retries.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
