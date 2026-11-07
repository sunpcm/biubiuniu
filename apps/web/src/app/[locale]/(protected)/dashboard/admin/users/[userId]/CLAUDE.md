# app/[locale]/(protected)/dashboard/admin/users/[userId]/
> L2 | Parent: /CLAUDE.md

Admin user detail — a 360° view of one user: profile, credit balances, subscription, lifetime stats and history. Reached from the admin user list.

Files
- page.tsx: Route entry (Server Component) — getUserDetailForAdmin in a single RPC, header card plus three stat cards, distinguishing notFound from loadFailed. All numbers and dates go through lib/format (formatNumber / formatDate); the page builds no Intl instances of its own.
- UserHistoryTabs.tsx: Client tabs — credit ledger (getAdminCreditTransactions) and orders (getAdminOrders), 20 rows per page through the shared table kit: usePagedQuery for page state and loading signals, DataTableContainer / DataTableEmptyState for the shell, TablePagination with its built-in English (admin page, no info / navLabels).
- AdjustCreditsButton.tsx: Opens ../AdjustCreditsDialog and calls router.refresh() through its onAdjusted callback — only a real adjustment refreshes the server-rendered balance card, cancelling does nothing.
- CopyText.tsx: Click-to-copy primitive used for email and Stripe customer ID.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
