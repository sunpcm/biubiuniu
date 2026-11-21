# components/pricing/
> L2 | Parent: /CLAUDE.md

Pricing display. Plan data and plan copy come from config/pricing.ts (copy is inlined per locale, read through getPlanCopy); the `Pricing` i18n namespace only supplies section-level UI text.

Files
- PricingSection.tsx: Server Component, id="pricing" anchor — three tabs (monthly / yearly / credit packs), with a team-plan sub-section under the personal grid when a team plan exists for that interval.
- PricingCard.tsx: Single card (name, description, price, strikethrough, credit highlight, features, popular badge); routes the CTA to PayPalCheckoutButton for PayPal credit packs and CheckoutButton otherwise.
- CheckoutButton.tsx: Purchase button — calls createCheckoutSession and redirects to the provider checkout; maps guard codes to the right destination (login, billing page, team page, or a toast).
- PayPalCheckoutButton.tsx: PayPal client button (PayPalScriptProvider + PayPalButtons) for one-time credit packs only — POST /api/paypal/create-order then /api/paypal/capture-order, then redirects to the success page.
- index.ts: Barrel, exports PricingSection only.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
