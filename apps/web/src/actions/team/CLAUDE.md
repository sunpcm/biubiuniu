# actions/team/
> L2 | Parent: /CLAUDE.md

The only data layer for the team management page. Every read is guarded by "the caller is a member of this organization".

Files
- index.ts: getTeamOverview(organizationId) → TeamOverview (shared credit pool, live team subscription, member count, pending invitations, seat cap), getTeamCreditHistory({ organizationId, pageIndex, pageSize }) → TeamCreditHistoryPage (paginated organization ledger); exports the TeamOverview / TeamCreditHistoryPage / TeamCreditHistoryItem types.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
