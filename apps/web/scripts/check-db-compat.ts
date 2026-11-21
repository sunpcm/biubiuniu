/**
 * Explicit read-only legacy-reference compatibility CLI.
 *
 * Verifies the existing `_n2_migration_journal` (three canonical identities and
 * their checksums) and the necessary physical schema without creating the
 * journal, writing `_niu` metadata, or running any DDL. This is the startup
 * gate for the old canonical chain and is deliberately separate from the new
 * `_niu` profile check. It does not load `.env`; `DATABASE_URL` must be
 * provided by the running environment or controller injection.
 */

import { checkMigrationCompatibility } from "../src/lib/db/migration-runner";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exitCode = 1;
    return;
  }

  try {
    const result = await checkMigrationCompatibility({ url });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.compatible) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

void main();
