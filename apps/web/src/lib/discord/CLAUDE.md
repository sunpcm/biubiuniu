# lib/discord/
> L2 | Parent: /CLAUDE.md

Discord ops notifications. Webhook URLs come from env (DISCORD_ORDER_WEBHOOK_URL for the order channel, DISCORD_WEBHOOK_URL as the fallback). Everything is fire-and-safe: failures are logged, never thrown, so a notification can never turn a payment webhook into a 5xx.

Files
- notifications.ts: sendDiscordNotification (generic embed sender) plus notifyNewOrder, notifyDuplicateSubscription, notifyPendingPayment, notifyPaymentDenied, notifyDispute and notifySignupGiftWithheld (the signup-gift cluster gate withheld a welcome gift).

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
