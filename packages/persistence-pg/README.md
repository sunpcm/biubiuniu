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
- `./schema/nano` — `nano_tasks`, `nano_active_jobs`, and
  `nano_case_selections`.
- `./auth` — the PostgreSQL auth policy store adapter (owned by the Auth
  domain writer).
- `./commerce` — the PostgreSQL commerce store adapter (owned by the Commerce
  domain writer).
- `./nano` — the product-scoped Nano task repository and transactional
  coordinator.

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

The adapters live under `src/auth/`, `src/commerce/` and `src/nano/`; they
implement the corresponding domain-owned ports without moving domain policy
into this package.

## Migration profiles

Modules are static, explicitly imported, and append-only:

| Module | Depends on | Creates |
| --- | --- | --- |
| `auth` | — | user, session, account, verification, organization, member, invitation, user_source |
| `payments` | `auth` | orders, subscriptions and billing enums |
| `credits` | `auth`, `payments` | credit_balances, organization_credit_balances, credit_transactions |
| `nano` | `auth`, `credits` | nano_tasks, nano_active_jobs, nano_case_selections |

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
| `nano_payments` | `auth`, `payments`, `credits`, `nano` |

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
the current version. The package currently exports
`DATABASE_CONTRACT_VERSION = 1`. The effective database contract version is the
maximum `contract_version` recorded in the journal.

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
- `nano`: `nano_tasks`, `nano_active_jobs`, `nano_case_selections`.

A missing sentinel table or column is reported in `missingTables` and makes the
profile incompatible, even when the journal rows are intact.

### Schema restriction and identifier safety

The new product chain targets the `public` schema (its SQL is written against
`public`). There is no fake non-public-schema support. Journal/profile table
names and profile labels are validated against a strict identifier pattern and
rejected before any SQL is assembled, so a malformed identifier cannot become
part of a query.

### Nano persistence contract

`nano_tasks` is the product-scoped history and dispatch state. `product_id`
participates in the request idempotency key and every repository operation is
bound to one product. `nano_active_jobs` enforces one active job per task and
keeps refundable subjects from being orphaned; terminal task history permits
deleted subjects to become `null`. `nano_case_selections` stores case-selection
statistics separately from generated output.

The Nano coordinator opens the transaction owned by the same
`PgCommerceStore` injected into Commerce. Admission, credit spend, spend
transaction association, active-job creation, failure/cancel transitions and
their refunds therefore share the caller's product-owned unit. Remote provider
calls happen outside that transaction.

## Boundaries and test status

- Commerce `webhookInbox` is listed in the migration boundary requirement but
  the requirement was withdrawn by the controller after a source re-check: no
  runtime-created `webhookInbox` table exists in the N2 reference. It is
  therefore **not** fabricated here, and it is not counted as a lost existing
  implementation.
- `/auth`, `/commerce` and `/nano` are implemented subpath adapters. The package
  still depends strongly on Auth, Commerce, Contracts and feature-Nano; selecting
  a smaller migration profile reduces physical tables but does **not** reduce the
  npm installation graph.
- The public profile and boundary tests prove planner/closure shape without a
  database. Real-PG tests remain explicit, identity-guarded suites and may skip
  when their dedicated URLs are absent.

## PG integration environment

Real-database verification covers new database creation, concurrency, checksum
rejection, fault atomicity, incremental upgrade and read-only compatibility.
The suites accept only a dedicated test database and role; required inputs are:

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

These suites exercise the persistence contract but do not by themselves approve
the overall product delivery. Acceptance status belongs to the corresponding
task's independent review and formal delivery report; an implementation report
is not an approval signal.
