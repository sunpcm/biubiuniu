# app/[locale]/(protected)/dashboard/admin/overview/
> L2 | Parent: /CLAUDE.md

Admin overview — a SaaS operations dashboard. One time window (?range=7d|30d|90d, UTC calendar days) drives the page; five sections stream in parallel under their own Suspense boundaries. Data comes from actions/overview.

Files
- page.tsx: Route entry (Server Component) — generateMetadata, range parsing, page header and the five Suspense sections.
- RangeSwitcher.tsx: Header segmented control; plain links that rewrite ?range=, zero client JS.
- KpiSection.tsx: Row one — net revenue, MRR, new signups, credit burn.
- StatTile.tsx: KPI card primitive (label / value / action / footnote) plus skeleton.
- DeltaBadge.tsx: Period-over-period badge; colour follows direction × invert.
- TrendSection.tsx: Row two left — fetches the daily series and hands it to TrendChart.
- TrendChart.tsx: Client Component — single-series bar chart with metric tabs (recharts + ui/chart), switching does not refetch.
- AttentionSection.tsx: Row two right — "needs attention" list (past-due subscriptions, pending orders, cancel-at-period-end, open feedback, failed orders, off-currency orders), each row links to its admin page.
- BreakdownSection.tsx: Row three — three distribution cards; maps keys to labels only.
- BreakdownList.tsx: Distribution list primitive (label / value / bar relative to max) plus skeleton.
- RecentOrdersSection.tsx: Row four — the 8 most recent orders, reusing the `Orders` namespace for copy.
- SectionError.tsx: Per-section failure state so one section cannot take down the page.

Conventions: amounts are integer cents; net = total − refunded; pending/failed do not count as revenue; reporting currency is the first active plan in the pricing config; signups exclude anonymous accounts; credit burn = usage − usage_refund; MRR = active + past_due at the configured monthly rate.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
