# @sunpcm/niu-db

Explicit PostgreSQL connection factory built on `postgres` and
`drizzle-orm/postgres-js`.

## Exports

- `createDatabase(options)` — creates a `DatabaseClient` with `db` (Drizzle),
  `client` (raw `postgres`), and `close()`. A missing/empty `connectionString`
  is rejected immediately.
- `createDatabaseConfig(config)` — builds a fresh `postgres` options object from
  explicit fields. No `process.env`, no platform auto-detection, no shared
  mutable state.
- `DBConfig` / `CreateDatabaseOptions` / `DatabaseClient` — TypeScript contracts.

Importing this package performs no I/O and runs no DDL.
