# app/[locale]/(protected)/dashboard/admin/coupons/
> L2 | Parent: /CLAUDE.md

Admin coupon console — Stripe promotion codes listed, filtered and created here.
Stripe is the only store: nothing about a coupon is persisted locally, so the
page reads and writes through actions/coupons/admin on every interaction. A code
is immutable once created, which shapes the whole UI: enable/disable is the only
edit, and "duplicate" is how a code gets changed.

Files
- page.tsx: Route entry (Server Component) — generateMetadata (`Coupons` namespace) and the Stripe availability flag the client cannot read itself.
- DataTable.tsx: Server-paginated table (getAdminPromotionCodes) with code/name search plus status and plan filters; owns the dialog state, the enable switch round trip, and the scan-cap warning.
- Columns.tsx: Column definitions — code with copy and auto-applied badge, discount, scope (plans + eligibility restrictions), duration, redemption progress, expiry, status, row actions.
- CouponFormDialog.tsx: Create / duplicate dialog (createAdminPromotionCode) — live code availability against Stripe, generated codes, expiry presets, multi-plan scope, and a summary sentence of what the customer gets.
- schemas.ts: Form validation and the string ↔ server-unit conversions (cents, epoch seconds, upper-cased codes), plus the code generator and expiry presets.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
