# actions/coupons/
> L2 | Parent: /CLAUDE.md

Admin coupon management. Stripe is the source of truth — no local table, no
migration: a coupon is a Stripe Coupon (discount, product scope, billing
duration) plus a Stripe Promotion Code (the customer-facing code, redemption
cap, expiry, restrictions). The customer-side path lives in actions/billing/
checkout, which auto-applies the code configured in config/pricing and otherwise
shows the provider's manual promo input.

Files
- admin.ts: getAdminPromotionCodes (one scan of Stripe, then search/status/plan filters and pagination in memory), createAdminPromotionCode (coupon + promo in one call, with rollback of the coupon when the promo is rejected), setPromotionCodeActive (the only mutation Stripe allows), checkPromotionCodeAvailability (pre-submit duplicate check).

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
