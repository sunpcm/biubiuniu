import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createDatabaseConfig, type DBConfig } from "./config.js";

/**
 * A live database handle: the Drizzle query builder, the raw `postgres` SQL
 * client (for native transactions/unsafe SQL), and an explicit close.
 *
 * Callers own the lifecycle and must call `close()` when done.
 */
export interface DatabaseClient<
  TSchema extends Record<string, unknown> = Record<string, never>,
> {
  /** Drizzle ORM instance bound to the injected schema. */
  db: PostgresJsDatabase<TSchema>;
  /** Raw `postgres` client for native SQL and explicit transaction control. */
  client: postgres.Sql;
  /** Close the connection pool. Idempotent via `postgres` `end()`. */
  close(): Promise<void>;
}

export interface CreateDatabaseOptions<
  TSchema extends Record<string, unknown> = Record<string, never>,
> extends DBConfig {
  /**
   * Optional Drizzle schema table map. When omitted, the returned `db` is a
   * schema-less Drizzle instance and callers query via `client` or `.execute`.
   */
  schema?: TSchema;
}

/**
 * Create an explicit database connection and return a closed-over handle.
 *
 * The connection string is required here; a missing/empty value is rejected
 * immediately with a clear error. Importing the module performs no I/O.
 */
export function createDatabase<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(options: CreateDatabaseOptions<TSchema>): DatabaseClient<TSchema> {
  if (!options.connectionString || options.connectionString.trim() === "") {
    throw new Error(
      "niu-db: connectionString is required to create a database connection",
    );
  }

  const { connectionString, schema, ...rest } = options;
  const client = postgres(connectionString, createDatabaseConfig(rest));

  const db = (schema === undefined
    ? drizzle(client)
    : drizzle(client, { schema })) as PostgresJsDatabase<TSchema>;

  return {
    db,
    client,
    close: () => client.end(),
  };
}
