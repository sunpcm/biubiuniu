# @sunpcm/niu-persistence-pg

PostgreSQL persistence adapter for the Nexty platform: explicit schema slices
and a composable, append-only migration profile engine.

Importing this package never opens a connection, reads `process.env`, or runs
DDL. Connections are created by the application assembly layer via
`@sunpcm/niu-db`, and migrations run only through the explicit runner.

## Exports

- `.` — migration planner/runner and its contracts (`planProfile`,
  `planModules`, `runMigrations`, `checkProfileCompatibility`, `PROFILES`,
  `ALL_MODULES`).
- `./migrations` — the same migration planner/runner entry, isolated from the
  schema/adapter subpaths.
- `./schema/auth` — `user`, `session`, `account`, `verification`,
  `organization`, `member`, `invitation`, `user_source`, and `user_role`.
- `./schema/commerce` — `orders`, `subscriptions`, `credit_balances`,
  `organization_credit_balances`, `credit_transactions`, and the billing
  enums.
- `./auth` — the PostgreSQL auth policy store adapter (owned by the Auth
  domain writer).
- `./commerce` — the PostgreSQL commerce store adapter (owned by the Commerce
  domain writer).

The root deliberately does **not** aggregate the schema. There is no full-schema
import; each domain slice is imported explicitly.

## Schema contract

The schema is a faithful reproduction of the N2 reference model:

- Export names and column names are unchanged.
- Amounts are integer cents; `credit_balances` keeps the two-bucket
  `subscription_credits` / `purchased_credits` shape.
- `orders` and `subscriptions` survive account deletion (`set null`), while the
  credit ledger is append-only (`restrict` on the organization, `set null` on
  the user, and a self-referencing `refunded_transaction_id` unique guard).
- `payment_provider` mirrors `@sunpcm/niu-contracts` `PaymentProvider`
  (`stripe`, `creem`, `paypal`).

The domain adapters live under `src/auth/` and `src/commerce/` and are owned by
their respective domain writers; this package does not own their implementation.

## Migration profiles

Modules are static, explicitly imported, and append-only:

| Module | Depends on | Creates |
| --- | --- | --- |
| `auth` | — | user, session, account, verification, organization, member, invitation, user_source |
| `payments` | `auth` | orders, subscriptions and billing enums |
| `credits` | `auth`, `payments` | credit_balances, organization_credit_balances, credit_transactions |

`credits` physically depends on `payments` because
`credit_transactions.order_id` references `orders.id`. The domain-level
"payments depend on credits" is a service-orchestration contract (the commerce
store writes both in one transaction), not a foreign-key dependency.

Profiles:

| Profile | Modules |
| --- | --- |
| `minimal` | (none — journal only) |
| `auth` | `auth` |
| `auth_credits` | `auth`, `payments`, `credits` |

`planProfile(name)` and `planModules(manifest, roots)` expand and validate the
dependency closure (unknown module, missing dependency, duplicate, cycle) before
any SQL runs. `runMigrations` applies the plan under an advisory lock, in one
transaction, recording module name, version, statement checksum, and raw
checksum and contract version in `_niu_migration_journal`, plus the activated
profile name in `_niu_migration_profile`. Repeated runs are idempotent; a
version, contract version, statement checksum, or raw checksum drift aborts the
batch.

`checkProfileCompatibility(...)` is a **read-only** check: it resolves the same
plan, enforces the same connection identity guard, then performs only SELECTs
against the journal and the physical schema. A missing or drifted module, a
missing declared sentinel table/column, or a database contract version outside
the consumer's supported range makes the profile incompatible and is reported
without any DDL or auto-migration. This is the startup gate applications use to
reject an unsupported database version before enabling a capability.

### Database contract version

Each module declares a `contractVersion` that is separate from its immutable
module `version` and from the npm package version. A breaking schema change
appends a new module with a higher `contractVersion`; an additive module reuses
the current version. The effective database contract version is the maximum
`contract_version` recorded in the journal.

`checkProfileCompatibility` reads that value and rejects it when it falls
outside the consumer's supported range (defaults to the plan's own module
contract versions, or an explicit `supportedContractVersions` option). This lets
an old consumer reject a breaking upgrade it does not understand while a new
consumer accepts it, without treating unrelated additive modules as a mismatch.

The read-only check does not trust the journal alone: it also verifies every
required business table for the selected modules physically exists. The declared
sentinels are explicit module metadata (not derived by parsing SQL):

- `auth`: `user`, `session`, `account`, `verification`, `organization`,
  `member`, `invitation`, `user_source`, plus `session.impersonated_by`.
- `payments`: `orders`, `subscriptions`.
- `credits`: `credit_balances`, `organization_credit_balances`,
  `credit_transactions`.

A missing sentinel table or column is reported in `missingTables` and makes the
profile incompatible, even when the journal rows are intact.

### Schema restriction and identifier safety

The new product chain targets the `public` schema (its SQL is written against
`public`). There is no fake non-public-schema support. Journal/profile table
names and profile labels are validated against a strict identifier pattern and
rejected before any SQL is assembled, so a malformed identifier cannot become
part of a query.

## Not implemented / pending

- Commerce `webhookInbox` is listed in the migration boundary requirement but
  the requirement was withdrawn by the controller after a source re-check: no
  runtime-created `webhookInbox` table exists in the N2 reference. It is
  therefore **not** fabricated here, and it is not counted as a lost existing
  implementation.
- The `/auth` and `/commerce` adapter subpath exports and their domain-package
  dependencies are reconciled by the integration owner after the Auth/Commerce
  writers report their final contracts.

## PG integration environment

Real-database verification (new database creation, concurrency, checksum
rejection, fault atomicity, incremental upgrade, read-only compatibility) is
deferred to the main controller after all writers stop. Required roles/URLs:

- `DATABASE_URL`
- `MIGRATION_C01_DATABASE_URL`
- `MIGRATION_FAULT_DATABASE_URL`

Test role: `nexty_overnight_test`.

The dedicated profile test (`test/packages/pg-profiles-pg.test.mjs`) uses its
own, isolated variables and a database/role guard so it never touches a shared
reference database:

- `PG_PROFILES_TEST_URL`
- `PG_PROFILES_TEST_EXPECTED_DATABASE`
- `PG_PROFILES_TEST_EXPECTED_ROLE`

When `PG_PROFILES_TEST_URL` is absent the suite is skipped; when present, every
scenario runs (zero internal skips) against that dedicated database. When the
URL is present, both `PG_PROFILES_TEST_EXPECTED_DATABASE` and
`PG_PROFILES_TEST_EXPECTED_ROLE` are mandatory and the role must be exactly
`nexty_overnight_test`; database names matching a reference/N2/disposable
pattern are rejected. The destructive reset verifies that same identity itself
before dropping any object, rather than relying on call ordering.
