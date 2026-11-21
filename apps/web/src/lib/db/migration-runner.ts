import postgres from "postgres";
import { defaultMigrationSource, toMigrationFile } from "./migration-source";
import type {
  MigrationFile,
  MigrationReport,
  MigrationRunnerOptions,
} from "./migration-types";

const DEFAULT_JOURNAL_TABLE = "_n2_migration_journal";
const DEFAULT_LOCK_KEY = "nexty-n2-migrate";

function qualifiedJournal(schema: string, table: string): string {
  return schema === "public" ? `"${table}"` : `"${schema}"."${table}"`;
}

function regclassFor(schema: string): string {
  return schema === "public" ? "user" : `"${schema}".user`;
}

async function defaultJournalWrite(
  tx: postgres.Sql,
  journal: string,
  file: MigrationFile,
): Promise<void> {
  await tx`insert into ${tx.unsafe(journal)} (name, checksum) values (${file.name}, ${file.checksum})`;
}

/**
 * Canonical migration runner shared by the product CLI and the domain tests.
 *
 * The whole run is one transaction: advisory lock, guard, journal bookkeeping,
 * DDL and verification commit or roll back together. Concurrent callers
 * serialize on the advisory lock; a checksum drift, DDL failure or journal
 * write failure rolls the whole batch back without leaving a half-applied
 * migration or a journal row without its DDL.
 */
export async function runMigrations(
  options: MigrationRunnerOptions,
): Promise<MigrationReport> {
  const {
    url,
    schema = "public",
    lockKey = DEFAULT_LOCK_KEY,
    source = defaultMigrationSource,
    guard,
    verifySchema = true,
    journalTable = DEFAULT_JOURNAL_TABLE,
    journalWrite,
  } = options;

  const journal = qualifiedJournal(schema, journalTable);
  const regclass = regclassFor(schema);
  const persist = journalWrite ?? defaultJournalWrite;

  const sql = postgres(url, { max: 1 });
  const report: MigrationReport = { applied: [], skipped: [], verified: [], files: [] };

  try {
    await sql.begin(async (rawTx) => {
      const tx = rawTx as unknown as postgres.Sql;

      await tx`select pg_advisory_xact_lock(hashtext(${lockKey}))`;

      if (guard) {
        const [row] = await tx<{ database: string; role: string }[]>`
          select current_database() as database, current_user as role
        `;
        guard(row.database, row.role);
      }

      await tx.unsafe(
        `create table if not exists ${journal} (
          name text primary key,
          checksum text not null,
          applied_at timestamptz not null default now()
        )`,
      );

      for (const name of source.list()) {
        const file = toMigrationFile(name, source.read(name));
        report.files.push(file);

        const [existing] = await tx<{ checksum: string }[]>`
          select checksum from ${tx.unsafe(journal)} where name = ${name}
        `;

        if (existing) {
          if (existing.checksum !== file.checksum) {
            throw new Error(
              `Migration ${name} checksum changed: journal=${existing.checksum} current=${file.checksum}`,
            );
          }
          report.skipped.push(name);
          continue;
        }

        await tx.unsafe(file.statements);
        await persist(tx, journal, file);
        report.applied.push(name);
      }

      if (verifySchema) {
        const [userVerified] = await tx<{ exists: boolean }[]>`
          select to_regclass(${regclass}) is not null as exists
        `;
        const [impVerified] = await tx<{ exists: boolean }[]>`
          select exists (
            select 1 from information_schema.columns
            where table_schema = ${schema}
              and table_name = 'session'
              and column_name = 'impersonated_by'
          ) as exists
        `;
        if (userVerified?.exists) report.verified.push("user");
        if (impVerified?.exists) report.verified.push("session.impersonated_by");
        if (!userVerified?.exists || !impVerified?.exists) {
          throw new Error(
            `Migration verification failed: verified=[${report.verified.join(",")}]`,
          );
        }
      }
    });
  } finally {
    await sql.end();
  }

  return report;
}

/**
 * Result of a read-only legacy-reference compatibility check.
 */
export interface LegacyMigrationCompatibility {
  compatible: boolean;
  /** Journal identities present with a matching canonical checksum. */
  applied: string[];
  /** Journal identities absent (or the journal itself is absent). */
  missing: string[];
  /** Journal identities present but with a drifted checksum. */
  incompatible: string[];
  /** Physical sentinel objects verified to exist. */
  verified: string[];
}

/**
 * Read-only legacy-reference compatibility check.
 *
 * Resolves the same canonical migration source as `runMigrations`, then
 * performs only SELECT queries against `_n2_migration_journal` and the
 * physical schema. It never acquires a lock, creates the journal, or runs DDL;
 * a missing journal, a missing identity, a drifted checksum, or a missing
 * sentinel table/column makes the reference incompatible and is reported
 * without any auto-migration. This is the explicit startup gate for the old
 * canonical chain and is separate from the new `_niu` profile check.
 */
export async function checkMigrationCompatibility(
  options: MigrationRunnerOptions,
): Promise<LegacyMigrationCompatibility> {
  const {
    url,
    schema = "public",
    source = defaultMigrationSource,
    guard,
    journalTable = DEFAULT_JOURNAL_TABLE,
  } = options;

  const journal = qualifiedJournal(schema, journalTable);
  const regclass = regclassFor(schema);
  const sql = postgres(url, { max: 1 });
  const result: LegacyMigrationCompatibility = {
    compatible: false,
    applied: [],
    missing: [],
    incompatible: [],
    verified: [],
  };

  try {
    if (guard) {
      const [row] = await sql<{ database: string; role: string }[]>`
        select current_database() as database, current_user as role
      `;
      guard(row.database, row.role);
    }

    const [journalRow] = await sql<{ exists: boolean }[]>`
      select to_regclass(${journal}) is not null as exists
    `;

    if (!journalRow?.exists) {
      result.missing.push(...source.list());
      return result;
    }

    for (const name of source.list()) {
      const file = toMigrationFile(name, source.read(name));
      const [row] = await sql<{ checksum: string }[]>`
        select checksum from ${sql.unsafe(journal)} where name = ${name}
      `;

      if (!row) {
        result.missing.push(name);
        continue;
      }

      if (row.checksum !== file.checksum) {
        result.incompatible.push(name);
        continue;
      }

      result.applied.push(name);
    }

    const [userVerified] = await sql<{ exists: boolean }[]>`
      select to_regclass(${regclass}) is not null as exists
    `;
    const [impVerified] = await sql<{ exists: boolean }[]>`
      select exists (
        select 1 from information_schema.columns
        where table_schema = ${schema}
          and table_name = 'session'
          and column_name = 'impersonated_by'
      ) as exists
    `;
    if (userVerified?.exists) result.verified.push("user");
    if (impVerified?.exists) result.verified.push("session.impersonated_by");
  } finally {
    await sql.end();
  }

  result.compatible =
    result.missing.length === 0 &&
    result.incompatible.length === 0 &&
    result.verified.includes("user") &&
    result.verified.includes("session.impersonated_by");

  return result;
}
