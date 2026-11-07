# app/[locale]/(protected)/dashboard/admin/credits/
> L2 | Parent: /CLAUDE.md

Admin credit ledger — global credit_transactions audit view plus batch grants by email. Data comes from actions/credits/admin.

Files
- page.tsx: Route entry (Server Component) — generateMetadata (`Credits` namespace) and CreditsDataTable assembly.
- DataTable.tsx: Server-paginated table (getAdminCreditTransactions), type filter and email/note search; owns BatchGrantDialog state.
- Columns.tsx: Ledger column definitions (time, user, type, amount, balance snapshot, note, row actions).
- BatchGrantDialog.tsx: Batch grant dialog (grantCreditsToUsers) — comma/newline separated emails, deduplicated, max 200, unmatched emails reported back.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
