# app/[locale]/(protected)/dashboard/admin/users/
> L2 | Parent: /CLAUDE.md

Admin user list — search, ban, roles, credit adjustments, impersonation, account deletion, plus the signup email / IP blocklist entry point.

Files
- page.tsx: Page entry — metadata from the `Users` namespace, renders DataTable.
- DataTable.tsx: TanStack table (server-side pagination, sorting, search plus ban-state / role / signup-date-range filters via actions/users/admin getUsers; the date range offers five presets and a two-month range picker, local calendar days converted to ISO instants); the toolbar action slot hosts SignupBlocklistSheet. Fetches under ADMIN_USERS_QUERY_KEY from use-user-row-action and feeds isPlaceholderData to the container. Pinning is declared for desktop only; the hook drops it on mobile.
- Columns.tsx: Column definitions (user with a destructive Banned badge, credits, total spent (lifetime net spend from settled orders, primary currency shown and sorted, other currencies in a tooltip), last active / signed up with a retention highlight when the last-active day is later than the signup day, Stripe ID, UTM, country, IP (signup IP from userSource, click to copy), browser, OS, device, affiliate code, actions). Row actions use RowActionButtons in the hybrid shape: View details and Adjust credits inline, Copy ID / role / impersonate / ban / delete in the overflow menu. The ban / unban / role / delete dialogs submit through useUserRowAction (optimistic row patch, background server action, rollback on failure).
  - Impersonate (ImpersonateDialog): superadmin only and only for plain users, disabled for banned accounts (unban first); the dialog spells out that credits and the card being charged are the user's, and a successful start does a full page load to /dashboard — the way back is the site-wide ImpersonationBanner.
- AdjustCreditsDialog.tsx: Manual credit adjustment dialog (positive delta grants purchased credits, negative deducts; a reason is required). Calls onAdjusted on success; the list passes useRefreshUsersTable so the credits column updates.
- use-user-row-action.ts: The user table's write side: ADMIN_USERS_QUERY_KEY (cache key source of truth), useUserRowAction (hooks/use-optimistic-row-action bound to the user rows) and useRefreshUsersTable (silent invalidate when no optimistic patch is possible).
- SignupBlocklistSheet.tsx: Signup blocklist panel (email prefix / suffix / exact-address rules plus an IP list, one per line; IPv4-mapped IPv6 is normalized on save) backed by actions/users/signup-blocklist.
- [userId]/: User detail drill-down (see [userId]/CLAUDE.md).

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
