/**
 * `@sunpcm/niu-db` — explicit PostgreSQL connection factory.
 *
 * This package exposes a connection factory and lifecycle handle only. It does
 * not export a database singleton, does not re-export the historical business
 * schema, and never reads process.env or loads dotenv on import. The legacy
 * `src/schema.ts`, `src/migrations/**`, and `src/seed/**` remain in the source
 * tree as historical reference only and are not part of the public package
 * payload.
 */
export { createDatabase, type CreateDatabaseOptions, type DatabaseClient } from "./factory.js";
export {
  createDatabaseConfig,
  type DBConfig,
  type DBTransform,
} from "./config.js";
