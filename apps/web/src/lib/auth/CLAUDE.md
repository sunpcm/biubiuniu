# lib/auth/
> L2 | Parent: /CLAUDE.md

Better Auth wrapper — the app-side adapter over `@sunpcm/niu-auth` (rules),
`@sunpcm/niu-next` (Next server/client adapters) and
`@sunpcm/niu-persistence-pg` (PostgreSQL identity/billing adapters). The single
assembly location is `../composition/auth.ts`.

Files
- index.ts: Server-only production wiring. Injects the real `@/lib/db`, Redis,
  React mail templates (`./mail.ts`), attribution writer, signup guard, request
  signal and Next plugins into `../composition/auth`, then exports `auth` and
  `policyStore`.
- mail.ts: Binds `@/lib/mail`'s `sendEmail` + React templates to the React-free
  `AuthMailer` contract. The only place the auth core's mail paths touch React.
- signup-rewards.ts: Thin adapter over `@sunpcm/niu-auth`'s reward orchestration
  (cluster decision -> welcome gift, never throws); injects credits config,
  `decideSignupGift`, the ledger writer and ops notification.
- guards.ts: Thin adapter over `@sunpcm/niu-auth`'s `createServerGuards`, keeping
  the legacy `{ auth, db, getHeaders }` shape for plain-Node callers/tests. The
  fresh channel re-reads ban state and live membership on every call.
- server.ts: Server-only production guards via `@sunpcm/niu-next`'s
  `createNextServerGuards` (next/headers + per-request `React.cache`).
- auth-client.ts: Client entry via `@sunpcm/niu-auth/client`'s
  `createAuthClientInstance`.
- admin-access.ts / permissions.ts / ban-policy.ts / disabled-paths.ts: Thin
  re-exports of the corresponding `@sunpcm/niu-auth` rule modules.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
