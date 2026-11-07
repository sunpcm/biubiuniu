# actions/users/
> L2 | Parent: /CLAUDE.md

Admin account management and user self-service settings.

Files
- admin.ts: getUsers (paginated, searchable, ban-state / role / signup-date-range filters ANDed with the search, server-side sort, joins source attribution incl. the signup IP + credit balances + last active + lifetime net spend per currency from settled orders), getUserDetailForAdmin (single RPC: profile, balances, subscription, lifetime stats), banUser / unbanUser, updateUserRole (superadmin only), deleteUserAccount (superadmin only; purges R2 assets before deleting the row). Every guard here reads the fresh session (getFreshSession / isAdmin), so a demoted or banned admin is cut off at once rather than when the cookie cache expires.
- impersonation.ts: startImpersonation (superadmin borrows a user's session — three guards: caller is superadmin (fresh session, not the cookie cache), target is neither an admin nor banned, and only superadmin holds user:impersonate in better-auth's access table; auth.api performs the cookie swap, stashing the admin's own session in the signed admin_session cookie) / stopImpersonation (gated on "this session is borrowed", not on the role — while impersonating the caller is a plain user). Sessions expire after an hour; both actions leave a warn-level audit trail. Consumed by the admin/users row action and ImpersonationBanner.
- signup-blocklist.ts: getSignupBlocklistAdmin / updateSignupBlocklistAdmin — the ops entry point for the signup blocklist (email prefix / suffix / exact plus IP, four groups; writes to Redis via lib/signup-blocklist, read live by the user.create.before hook).
- settings.ts: User side — profile update (name validation, avatar upload to R2, old avatar cleanup).

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
