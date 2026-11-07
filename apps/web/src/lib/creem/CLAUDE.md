# lib/creem/
> L2 | Parent: /CLAUDE.md

Creem SDK layer — transport and types only, no business logic. Built on the official `creem` 1.x TypeScript SDK, authenticated with CREEM_API_KEY; test/live mode is derived from the key prefix. Webhook payloads are translated to business calls in lib/billing/creem.ts. Amounts are integer cents.

Files
- client.ts: Lazy SDK singleton getCreem plus isCreemEnabled / creemMode, and thin wrappers — createCreemCheckoutSession, retrieveCreemCheckoutSession, retrieveCreemSubscription, cancelCreemSubscription, refundCreemTransaction, createCreemCustomerPortalLink. Errors keep the original SDK text so lib/billing can classify them.
- types.ts: SDK type facade — entity aliases (CreemCheckout, CreemOrder, CreemTransaction, CreemSubscription, CreemRefund, CreemDispute, CreemCustomer, CreemProduct) and the webhook event union CreemWebhookEvent / CreemWebhookEventType.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
