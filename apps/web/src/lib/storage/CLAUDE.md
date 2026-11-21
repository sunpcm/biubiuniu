# lib/storage/
> L2 | Parent: /CLAUDE.md

Storage lifecycle — account-level cleanup of a user's R2 assets.

Files
- account-purge.ts: purgeUserArtifacts(userId) — paginates through the user's R2 object prefixes (config/common `avatars/{userId}/`) and deletes them. Called by deleteUserAccount before the row is deleted; a failure aborts the deletion and retries converge because DeleteObject is idempotent. Add new user-scoped prefixes to userArtifactPrefixes.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
