# app/[locale]/(protected)/dashboard/credit-usage-example/
> L2 | Parent: /CLAUDE.md

Developer reference page (development mode only) — interactive test cases showing every path for wiring a business feature into the credit system. Not a product feature.

Files
- page.tsx: Client page — bucket balances, three test cases (successful spend, simulated task failure with refund and idempotent replay, insufficient balance upsell) and a run log.
- actions.ts: Development-only server action simulateFailedTask — runs the spend → fail → refund → replay loop server-side and refuses to run in production.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
