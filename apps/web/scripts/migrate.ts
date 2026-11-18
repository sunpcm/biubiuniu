import { runMigrations, takeoverMigrations } from "@sunpcm/niu-persistence-pg/migrations";
import postgres from "postgres";
import { productMigrationOptions } from "../src/lib/db/product-migrations/compatibility";
import {
  PRODUCT_LEGACY_JOURNAL,
  PRODUCT_LEGACY_SCHEMA_CONTRACT,
} from "../src/lib/db/product-migrations/legacy-contract";

async function legacyJournalExists(
  url: string,
  guard: (database: string, role: string) => void,
): Promise<boolean> {
  const sql = postgres(url, { max: 1 });
  try {
    const [probe] = await sql<
      {
        database: string;
        role: string;
        legacy_journal: boolean;
      }[]
    >`
      select
        pg_catalog.current_database() as database,
        current_user as role,
        pg_catalog.to_regclass('public._n2_migration_journal') is not null as legacy_journal
    `;
    if (!probe) {
      throw new Error("Migration database probe returned no identity");
    }
    guard(probe.database, probe.role);
    return probe.legacy_journal;
  } finally {
    await sql.end();
  }
}

async function main(): Promise<void> {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl?.trim()) {
    console.error("DATABASE_URL is not set");
    process.exitCode = 1;
    return;
  }

  try {
    const options = productMigrationOptions(rawUrl);
    if (!options.guard) {
      throw new Error("Product migration identity guard is missing");
    }
    const legacy = await legacyJournalExists(options.url, options.guard);
    const report = legacy
      ? await takeoverMigrations({
          ...options,
          schemaContract: PRODUCT_LEGACY_SCHEMA_CONTRACT,
          legacyJournal: PRODUCT_LEGACY_JOURNAL,
        })
      : await runMigrations(options);

    const modules = report.modules.map((module) => ({
      name: module.name,
      version: module.version,
      contractVersion: module.contractVersion,
      checksum: module.checksum,
      rawChecksum: module.rawChecksum,
    }));

    process.stdout.write(`${JSON.stringify({ ...report, modules }, null, 2)}\n`);
  } catch {
    console.error("Product migration failed safely; migration details are suppressed");
    process.exitCode = 1;
  }
}

void main();
