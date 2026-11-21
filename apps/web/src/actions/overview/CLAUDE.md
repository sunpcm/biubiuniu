# actions/overview/
> L2 | Parent: /CLAUDE.md

Read-only aggregates for the admin overview page. One time window (UTC calendar days, current vs. previous) drives all five entry points, one per Suspense section of the page.

Files
- range.ts: Time-window source of truth — OVERVIEW_RANGES (7d/30d/90d), parseRange, resolveWindow, utcDayKey.
- index.ts: getOverviewKpis (revenue, refunds, orders, signups, MRR, credit burn, active users), getOverviewTrend (daily series), getOverviewBreakdowns (by plan / provider / signup source), getOverviewAttention (rows needing action), getRecentOrders.

Conventions: amounts are integer cents; net = amount_total − amount_refunded; settled = completed | partially_refunded | refunded; reporting currency = activePricingPlans[0].currency; signups exclude anonymous accounts; credit burn = usage − usage_refund.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
