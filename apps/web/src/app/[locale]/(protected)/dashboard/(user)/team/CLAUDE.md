# app/[locale]/(protected)/dashboard/(user)/team/
> L2 | Parent: /CLAUDE.md

Team management page — a four-card dashboard when the active workspace is an organization, otherwise a create/select onboarding flow. All data comes from actions/team.

Files
- page.tsx: Server entry — getWorkspaceContext routes to TeamDashboard or TeamOnboarding; ?create=1 forces the create view, ?plan= is passed through.
- TeamDashboard.tsx: Four-card layout (subscription, shared credit pool, members/seats, activity) via react-query; page-level refresh refetches every source. The purchaser's Manage button opens the provider portal in one click (actions/billing/portal); the ?plan= round trip places the team checkout automatically for the owner (actions/billing/checkout), stripping the param first so a reload cannot re-fire it.
- TeamMembersCard.tsx: Member list (role changes, removal, self-leave) plus a three-state invite area (no subscription → upgrade prompt / seats full → inline notice / otherwise the invite form) and the pending invitation list.
- TeamActivityCard.tsx: Paginated organization credit ledger (getTeamCreditHistory) on the shared table kit: usePagedQuery (query key ["team-credit-history", organizationId], the one TeamDashboard's refresh invalidates), DataTableContainer / DataTableEmptyState, TablePagination with Team translations via info / navLabels. fetchPage throws on failure so react-query's error channel renders the retry state.
- TeamOnboarding.tsx: Create or select a team; the create view is URL-driven and converges back through page.tsx after setActive.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
