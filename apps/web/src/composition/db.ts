/**
 * Application database composition.
 *
 * This is the single assembly point that turns an explicit connection string
 * into a live database handle using the public `@sunpcm/niu-db` factory. The
 * package never reads `process.env`; this app-level module performs the
 * platform/database detection and reads `NODE_ENV` only for debug/notice
 * defaults. Other app code should consume the lazy handle below rather than
 * re-opening the database.
 */

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import {
  createDatabase,
  type CreateDatabaseOptions,
  type DatabaseClient,
} from "@sunpcm/niu-db";
import * as schema from "../lib/db/schema";

type Platform = "vercel" | "netlify" | "lambda" | "server";
type DatabaseKind = "supabase" | "neon" | "aws-rds" | "gcp-sql" | "self-hosted";

function detectPlatform(): Platform {
  if (process.env.VERCEL_ENV) return "vercel";
  if (process.env.NETLIFY) return "netlify";
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return "lambda";
  return "server";
}

function detectDatabase(connectionString: string): DatabaseKind {
  if (connectionString.includes("supabase")) return "supabase";
  if (connectionString.includes("neon")) return "neon";
  if (connectionString.includes("amazonaws.com")) return "aws-rds";
  if (connectionString.includes("googleapis.com")) return "gcp-sql";
  return "self-hosted";
}

/**
 * Build explicit, driver-level options for `@sunpcm/niu-db` `createDatabase`.
 *
 * The N2-approved driver semantics are preserved: `transform.undefined = null`
 * and, for Supabase pooled connections, `connection.statement_timeout = 30000`.
 * The historical `transform.date: true` is intentionally dropped because
 * postgres.js 3.4.x removed the `transform.date` hook (it was silently
 * ignored); `keepalive: true` is likewise not re-added because the locked
 * driver exposes `keep_alive` (seconds) rather than a boolean `keepalive`.
 */
export function buildDatabaseOptions(
  connectionString: string,
): Omit<CreateDatabaseOptions<typeof schema>, "connectionString" | "schema"> {
  const platform = detectPlatform();
  const database = detectDatabase(connectionString);

  const platformConfig: Record<
    Platform,
    Pick<
      CreateDatabaseOptions<typeof schema>,
      "maxConnections" | "enablePrepare" | "idleTimeout" | "maxLifetime" | "connectTimeout"
    >
  > = {
    vercel: { maxConnections: 3, enablePrepare: false, idleTimeout: 20, maxLifetime: 1800, connectTimeout: 15 },
    netlify: { maxConnections: 3, enablePrepare: false, idleTimeout: 20, maxLifetime: 1800, connectTimeout: 15 },
    lambda: { maxConnections: 3, enablePrepare: false, idleTimeout: 20, maxLifetime: 1800, connectTimeout: 30 },
    server: { maxConnections: 30, enablePrepare: true, idleTimeout: 300, maxLifetime: 3600, connectTimeout: 30 },
  };

  const databaseConfig: Record<
    DatabaseKind,
    Pick<
      CreateDatabaseOptions<typeof schema>,
      "enableSSL" | "applicationName" | "enablePrepare" | "idleTimeout" | "connectTimeout"
    >
  > = {
    supabase: { enableSSL: "require", applicationName: "drizzle-supabase", enablePrepare: false },
    neon: { enableSSL: "require", applicationName: "drizzle-neon", enablePrepare: false, connectTimeout: 20 },
    "aws-rds": { enableSSL: "require", applicationName: "drizzle-aws", idleTimeout: 60 },
    "gcp-sql": { enableSSL: "require", applicationName: "drizzle-gcp" },
    "self-hosted": { enableSSL: false, applicationName: "drizzle-app" },
  };

  return {
    ...platformConfig[platform],
    ...databaseConfig[database],
    transform: { undefined: null },
    ...(database === "supabase" ? { connection: { statement_timeout: 30000 } } : {}),
    debug: process.env.NODE_ENV === "development",
    onNotice: process.env.NODE_ENV === "development" ? console.log : undefined,
  };
}

/**
 * A handle that never opens a connection and rejects its first real use with a
 * clear error. It exists so importing the schema without `DATABASE_URL` stays
 * safe (no throw at module load) while a real query fails loudly instead of
 * silently falling back to the driver's `PG*` environment defaults.
 */
function createMissingConfigHandle(): DatabaseClient<typeof schema> {
  const fail = (): never => {
    throw new Error("DATABASE_URL is not set; cannot connect to the database");
  };
  const client = new Proxy(fail, {
    get: fail,
    apply: fail,
  }) as unknown as postgres.Sql;
  const db = new Proxy({}, {
    get: fail,
    apply: fail,
  }) as unknown as PostgresJsDatabase<typeof schema>;
  return { db, client, close: async () => {} };
}

/**
 * Create a database handle from an explicit connection string.
 *
 * A missing/empty connection string returns a deferred-failure handle rather
 * than opening a `postgres("")` client (which would use driver `PG*` defaults
 * and may connect to an unintended database). Builds and tests that import the
 * schema without a live database keep working; the first real query rejects.
 */
export function createAppDatabase(
  connectionString: string,
): DatabaseClient<typeof schema> {
  if (!connectionString) {
    return createMissingConfigHandle();
  }

  return createDatabase({
    connectionString,
    schema,
    ...buildDatabaseOptions(connectionString),
  });
}

let singleton: DatabaseClient<typeof schema> | null = null;

/** Return the process-wide database singleton, creating it on first use. */
export function getDatabase(): DatabaseClient<typeof schema> {
  if (singleton) return singleton;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Deferred failure (not an eager throw): import stays safe, first query
    // rejects. See `createMissingConfigHandle`.
    singleton = createMissingConfigHandle();
    return singleton;
  }
  singleton = createAppDatabase(connectionString);
  return singleton;
}

/**
 * Close and reset the process-wide singleton (idempotent). A subsequent
 * `getDatabase()` call builds a fresh pool.
 */
export async function closeDatabase(): Promise<void> {
  if (!singleton) return;
  const current = singleton;
  singleton = null;
  await current.close();
}
