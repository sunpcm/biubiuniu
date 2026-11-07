/**
 * `@sunpcm/niu-persistence-pg` — PostgreSQL persistence adapter.
 *
 * The package root exposes only the migration planner/runner and its contracts.
 * It deliberately does NOT aggregate the auth or commerce schema, and it never
 * runs DDL on import. Schema tables are consumed through the explicit
 * `/schema/auth` and `/schema/commerce` subpaths; domain adapters live under
 * `/auth` and `/commerce`.
 */
export * from "./migrations/index.js";
