/**
 * Process-wide database handle for the reference app.
 *
 * `../composition/db` is the single owner of the process-wide singleton. This
 * module only re-exposes that handle: there is exactly one pool, and
 * `closeDatabase` closes that same pool (not a separate instance). A missing
 * `DATABASE_URL` keeps the legacy import-time behavior (no throw at module
 * load; the first real query rejects clearly with no implicit driver default
 * connection).
 */

import { closeDatabase, getDatabase } from "../../composition/db";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.log("DATABASE_URL is not set");
}

const database = getDatabase();

export const db = database.db;

/** Close the single process-wide pool — tests call this so the runner can exit. */
export { closeDatabase };

export const isDatabaseEnabled = !!connectionString;
