import type postgres from "postgres";

/**
 * Explicit `postgres` driver transform hooks.
 *
 * The concrete field set matches the locked `postgres` 3.4.x driver. The
 * historical `date: true` transform is intentionally absent: postgres.js 3.x
 * removed the `transform.date` hook, so that value was silently ignored and
 * never affected date serialization. Only the hooks the driver actually
 * reads are exposed here.
 */
export interface DBTransform {
  /** Replace outcoming `undefined` values before sending (e.g. `null`). */
  undefined?: unknown;
  /** Transform incoming/outgoing column names. */
  column?:
    | ((column: string) => string)
    | { from?: (column: string) => string; to?: (column: string) => string };
  /** Transform incoming row values. */
  value?:
    | ((value: unknown) => unknown)
    | { from?: (value: unknown, column?: unknown) => unknown };
  /** Transform entire incoming rows. */
  row?: ((row: unknown) => unknown) | { from?: (row: unknown) => unknown };
}

/**
 * Explicit connection options for the `postgres` driver.
 *
 * Every deployment-affecting value is passed in by the caller. The factory
 * performs no platform auto-detection and reads no process environment (no
 * `NODE_ENV`, `VERCEL_ENV`, `DATABASE_URL`, or similar). Importing this module
 * never opens a connection and never runs DDL.
 */
export interface DBConfig {
  /** PostgreSQL connection string (required at `createDatabase` time). */
  connectionString: string;
  /** Max pooled connections (`postgres` `max`). */
  maxConnections?: number;
  /** Enable prepared statements (`postgres` `prepare`). */
  enablePrepare?: boolean;
  /** TLS mode (`postgres` `ssl`). */
  enableSSL?: boolean | "require";
  /** Debug logging (`postgres` `debug`). */
  debug?: boolean | ((connection: number, query: string, parameters: unknown[], paramTypes: unknown[]) => void);
  /** Idle connection timeout in seconds (`postgres` `idle_timeout`). */
  idleTimeout?: number;
  /** Connection timeout in seconds (`postgres` `connect_timeout`). */
  connectTimeout?: number;
  /** Max connection lifetime in seconds (`postgres` `max_lifetime`). */
  maxLifetime?: number | null;
  /** Server `application_name` (`postgres` `connection.application_name`). */
  applicationName?: string;
  /** Notice callback (`postgres` `onnotice`). */
  onNotice?: (notice: postgres.Notice) => void;
  /** Explicit driver transform hooks (e.g. `{ undefined: null }`). */
  transform?: DBTransform;
  /**
   * Explicit driver connection parameters (e.g.
   * `{ statement_timeout: 30000 }`). Merged with `applicationName`; an
   * explicit `application_name` here wins over the legacy top-level field.
   */
  connection?: Partial<postgres.ConnectionParameters>;
}

/**
 * Build a fresh `postgres` options object from explicit DBConfig fields.
 *
 * A new object is returned on every call; two callers never share a mutable
 * options instance. No value falls back to `process.env`.
 */
export function createDatabaseConfig(
  config: Omit<DBConfig, "connectionString">,
): postgres.Options<Record<string, postgres.PostgresType>> {
  const options: postgres.Options<Record<string, postgres.PostgresType>> = {};

  if (config.maxConnections !== undefined) options.max = config.maxConnections;
  if (config.enablePrepare !== undefined) options.prepare = config.enablePrepare;
  if (config.enableSSL !== undefined) options.ssl = config.enableSSL;
  if (config.debug !== undefined) options.debug = config.debug;
  if (config.idleTimeout !== undefined) options.idle_timeout = config.idleTimeout;
  if (config.connectTimeout !== undefined) options.connect_timeout = config.connectTimeout;
  if (config.maxLifetime !== undefined) options.max_lifetime = config.maxLifetime;
  if (config.onNotice !== undefined) options.onnotice = config.onNotice;

  if (config.transform !== undefined) {
    options.transform = { ...config.transform };
  }

  if (config.applicationName !== undefined || config.connection !== undefined) {
    const connection: Partial<postgres.ConnectionParameters> = {
      ...(config.connection ?? {}),
    };
    // Merge the legacy top-level applicationName into the connection map
    // without clobbering other connection parameters (e.g. statement_timeout).
    if (config.applicationName !== undefined && connection.application_name === undefined) {
      connection.application_name = config.applicationName;
    }
    options.connection = connection;
  }

  return options;
}
