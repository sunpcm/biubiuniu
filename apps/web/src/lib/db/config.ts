/**
 * Backward-compatible database factory shim.
 *
 * The canonical assembly now lives in `../composition/db`. This module keeps
 * the legacy `createDatabase` export returning a Drizzle instance so existing
 * scripts (e.g. `scripts/create-superadmin.ts`) keep working without change,
 * and re-exports the public config builder from `@sunpcm/niu-db`.
 */

import {
  createDatabaseConfig,
  type DBConfig,
} from "@sunpcm/niu-db";
import { createAppDatabase } from "../../composition/db";

export { createDatabaseConfig };
export type { DBConfig };

/** Legacy drizzle-instance factory; delegates to the public factory. */
export function createDatabase(config: { connectionString: string }): ReturnType<typeof createAppDatabase>["db"] {
  return createAppDatabase(config.connectionString).db;
}
