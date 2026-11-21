# app/[locale]/(protected)/dashboard/(user)/
> L2 | Parent: /CLAUDE.md

User-side dashboard route group: everything a signed-in member manages for themselves (settings, billing, orders, credit history, team, feedback). Admin pages live in the sibling admin/ group and stay full width.

Files
- layout.tsx: Route-group layout — one centered, width-capped container (`container mx-auto`) around every user page; keeps flex-1 / min-h-0 so the credit-history and my-orders tables still fill the viewport height. Padding comes from dashboard/layout's SidebarInset.
- settings/: Profile settings (name, avatar upload to R2).
- billing/: Personal billing: credit buckets, current plan, purchase and credit history (see billing/CLAUDE.md).
- my-orders/: Standalone order list with provider and status columns (page + DataTable + Columns).
- credit-history/: Standalone credit ledger with type filter and per-bucket columns (page + CreditHistoryDataTable + Columns).
- team/: Team workspace: members, seats, shared credit pool, activity (see team/CLAUDE.md).
- my-feedbacks/: The user's own feedback threads (page + list + FeedbackDetailSheet).

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
