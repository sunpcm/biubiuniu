import postgres from "postgres";
import { assertSafeIdentifier, quoteIdentifier } from "./identifiers.js";
import { planModules, planProfile } from "./planner.js";
import type {
  MigrationCompatibility,
  MigrationModule,
  MigrationPlan,
  MigrationReport,
  ResolvedModule,
} from "./types.js";

const DEFAULT_JOURNAL_TABLE = "_niu_migration_journal";
const DEFAULT_PROFILE_TABLE = "_niu_migration_profile";
export const DEFAULT_MIGRATION_LOCK_KEY = "niu-persistence-pg:migration";

export interface MigrationRunnerOptions {
  url: string;
  /** Profile label recorded in the profile journal. Also the built-in profile name when no explicit modules are given. */
  profile: string;
  /** Explicit module manifest + roots for append/upgrade runs (overrides built-in profiles). */
  modules?: readonly MigrationModule[];
  roots?: readonly string[];
  lockKey?: string;
  /** Safe identifier for the module journal table. */
  journalTable?: string;
  /** Safe identifier for the profile-activation table. */
  profileTable?: string;
  verifySchema?: boolean;
  /** Reject before applying if the connected database/role is unexpected. */
  guard?: (database: string, role: string) => void;
  /**
   * Database contract versions this consumer supports. When omitted, it is
   * derived from the plan's module contract versions.
   */
  supportedContractVersions?: readonly number[];
}

export function resolveMigrationPlan(options: MigrationRunnerOptions): MigrationPlan {
  if (options.modules !== undefined || options.roots !== undefined) {
    if (options.modules === undefined || options.roots === undefined) {
      throw new Error("Migration runner: modules and roots must be provided together");
    }
    return { ...planModules(options.modules, options.roots), profile: options.profile };
  }
  return planProfile(options.profile);
}

export function assertMigrationJournalNames(options: MigrationRunnerOptions): {
  journal: string;
  profile: string;
} {
  const journal = options.journalTable ?? DEFAULT_JOURNAL_TABLE;
  const profile = options.profileTable ?? DEFAULT_PROFILE_TABLE;
  assertSafeIdentifier(journal, "journalTable");
  assertSafeIdentifier(profile, "profileTable");
  assertSafeIdentifier(options.profile, "profile");
  return { journal, profile };
}

function publicRelation(identifier: string): string {
  return `${quoteIdentifier("public")}.${quoteIdentifier(identifier)}`;
}

export async function acquireMigrationLock(
  tx: postgres.Sql,
  lockKey = DEFAULT_MIGRATION_LOCK_KEY,
): Promise<void> {
  await tx`select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(${lockKey}))`;
}

export async function assertMigrationGuard(
  tx: postgres.Sql,
  guard?: (database: string, role: string) => void,
): Promise<void> {
  if (!guard) return;
  const [row] = await tx<{ database: string; role: string }[]>`
    select pg_catalog.current_database() as database, current_user as role
  `;
  if (!row) {
    throw new Error("Migration runner: identity query returned no row");
  }
  guard(row.database, row.role);
}

export async function createMigrationMetadata(
  tx: postgres.Sql,
  names: { journal: string; profile: string },
): Promise<void> {
  const journalQ = publicRelation(names.journal);
  const profileQ = publicRelation(names.profile);
  await tx.unsafe(
    `create table if not exists ${journalQ} (
      module_name text primary key,
      version integer not null,
      contract_version integer not null,
      checksum text not null,
      raw_checksum text not null,
      applied_at timestamptz not null default now()
    )`,
  );
  await tx.unsafe(
    `create table if not exists ${profileQ} (
      profile_name text primary key,
      applied_at timestamptz not null default now()
    )`,
  );
}

export async function writeMigrationJournalEntry(
  tx: postgres.Sql,
  journal: string,
  module: ResolvedModule,
): Promise<void> {
  const journalQ = publicRelation(journal);
  await tx`
    insert into ${tx.unsafe(journalQ)}
      (module_name, version, contract_version, checksum, raw_checksum)
    values
      (${module.name}, ${module.version}, ${module.contractVersion}, ${module.checksum}, ${module.rawChecksum})
  `;
}

export async function writeMigrationProfile(
  tx: postgres.Sql,
  profile: string,
  profileName: string,
): Promise<void> {
  const profileQ = publicRelation(profile);
  await tx`
    insert into ${tx.unsafe(profileQ)} (profile_name)
    values (${profileName})
    on conflict (profile_name) do nothing
  `;
}

function supportedContractVersions(options: MigrationRunnerOptions, plan: MigrationPlan): number[] {
  const source = options.supportedContractVersions ?? plan.modules.map((m) => m.contractVersion);
  return [...new Set(source)].sort((a, b) => a - b);
}

export interface SchemaSentinels {
  tables: string[];
  columns: string[];
}

/**
 * Declared physical-schema sentinels for the selected modules.
 *
 * These are the minimal tables/columns a consumer relies on, used by both the
 * write-time verification and the read-only compatibility check. A read-only
 * check must not trust the journal alone; it also verifies these objects exist.
 */
export function migrationSchemaSentinels(modules: readonly ResolvedModule[]): SchemaSentinels {
  const names = new Set(modules.map((module) => module.name));
  const tables = new Set<string>();
  const columns = new Set<string>();
  if (names.has("auth")) {
    tables.add("user");
    tables.add("session");
    tables.add("account");
    tables.add("verification");
    tables.add("organization");
    tables.add("member");
    tables.add("invitation");
    tables.add("user_source");
    columns.add("session.impersonated_by");
  }
  if (names.has("payments")) {
    tables.add("orders");
    tables.add("subscriptions");
  }
  if (names.has("credits")) {
    tables.add("credit_balances");
    tables.add("organization_credit_balances");
    tables.add("credit_transactions");
  }
  if (names.has("nano")) {
    tables.add("nano_tasks");
    tables.add("nano_active_jobs");
    tables.add("nano_case_selections");
  }
  return { tables: [...tables].sort(), columns: [...columns].sort() };
}

function splitColumnSentinel(column: string): { table: string; column: string } {
  const dot = column.lastIndexOf(".");
  if (dot <= 0 || dot === column.length - 1) {
    throw new Error(`Invalid schema sentinel column: ${column}`);
  }
  return { table: column.slice(0, dot), column: column.slice(dot + 1) };
}

/**
 * Apply a resolved profile to a physical database.
 *
 * The whole run is one transaction: advisory lock, guard, journal/profile table
 * creation, module application, and verification commit or roll back together.
 * Repeated runs are idempotent — an already-applied module with matching
 * version, contract version, statement checksum, and raw checksum is skipped;
 * any drift aborts. A module's contract version is recorded alongside its
 * identity so a later read-only consumer can detect a breaking upgrade.
 */
export async function runMigrations(options: MigrationRunnerOptions): Promise<MigrationReport> {
  const { url, lockKey = DEFAULT_MIGRATION_LOCK_KEY, verifySchema = true, guard } = options;

  const plan = resolveMigrationPlan(options);
  const names = assertMigrationJournalNames(options);
  const journalQ = publicRelation(names.journal);
  const sentinels = migrationSchemaSentinels(plan.modules);
  const sql = postgres(url, { max: 1 });
  const report: MigrationReport = {
    profile: plan.profile,
    applied: [],
    skipped: [],
    verified: [],
    modules: plan.modules,
  };

  try {
    await sql.begin(async (rawTx) => {
      const tx = rawTx as unknown as postgres.Sql;

      await acquireMigrationLock(tx, lockKey);
      await assertMigrationGuard(tx, guard);
      await createMigrationMetadata(tx, names);

      for (const module of plan.modules) {
        const [existing] = await tx<
          {
            version: number;
            contract_version: number;
            checksum: string;
            raw_checksum: string;
          }[]
        >`
          select version, contract_version, checksum, raw_checksum
          from ${tx.unsafe(journalQ)}
          where module_name = ${module.name}
        `;

        if (existing) {
          if (existing.version !== module.version) {
            throw new Error(
              `Migration module ${module.name} version changed: journal=${existing.version} current=${module.version}`,
            );
          }
          if (existing.contract_version !== module.contractVersion) {
            throw new Error(
              `Migration module ${module.name} contract version changed: journal=${existing.contract_version} current=${module.contractVersion}`,
            );
          }
          if (existing.checksum !== module.checksum) {
            throw new Error(
              `Migration module ${module.name} statement checksum changed: journal=${existing.checksum} current=${module.checksum}`,
            );
          }
          if (existing.raw_checksum !== module.rawChecksum) {
            throw new Error(
              `Migration module ${module.name} raw checksum changed: journal=${existing.raw_checksum} current=${module.rawChecksum}`,
            );
          }
          report.skipped.push(module.name);
          continue;
        }

        await tx.unsafe(module.statements);
        await writeMigrationJournalEntry(tx, names.journal, module);
        report.applied.push(module.name);
      }

      await writeMigrationProfile(tx, names.profile, plan.profile);

      if (verifySchema) {
        for (const table of sentinels.tables) {
          const [row] = await tx<{ exists: boolean }[]>`
          select pg_catalog.to_regclass(${`public.${table}`}) is not null as exists
          `;
          if (row?.exists) report.verified.push(table);
        }

        for (const column of sentinels.columns) {
          const { table, column: columnName } = splitColumnSentinel(column);
          const [row] = await tx<{ exists: boolean }[]>`
            select exists (
              select 1 from information_schema.columns
              where table_schema = 'public'
                and table_name = ${table}
                and column_name = ${columnName}
            ) as exists
          `;
          if (row?.exists) report.verified.push(column);
        }

        const expected = [...sentinels.tables, ...sentinels.columns];
        const missing = expected.filter((item) => !report.verified.includes(item));
        if (missing.length > 0) {
          throw new Error(`Migration verification failed: missing=${missing.join(",")}`);
        }
      }
    });
  } finally {
    await sql.end();
  }

  return report;
}

/**
 * Read-only compatibility check.
 *
 * Resolves the same plan as `runMigrations`, then performs only SELECT queries.
 * It first enforces the same connection identity guard, then checks the journal
 * fingerprints and the physical presence of declared sentinel tables/columns.
 * It never acquires a lock, creates tables, or runs DDL; a missing or drifted
 * module, a missing sentinel object, or a database contract version outside the
 * consumer's supported range makes the profile incompatible rather than being
 * auto-migrated.
 */
export async function checkProfileCompatibility(
  options: MigrationRunnerOptions,
): Promise<MigrationCompatibility> {
  const { url, guard } = options;
  const plan = resolveMigrationPlan(options);
  const { journal } = assertMigrationJournalNames(options);
  const journalQ = publicRelation(journal);
  const supported = supportedContractVersions(options, plan);
  const sentinels = migrationSchemaSentinels(plan.modules);
  const sql = postgres(url, { max: 1 });
  const result: MigrationCompatibility = {
    profile: plan.profile,
    compatible: false,
    applied: [],
    missing: [],
    incompatible: [],
    missingTables: [],
    supportedContractVersions: supported,
    contractVersionMismatch: false,
  };

  try {
    await assertMigrationGuard(sql, guard);

    const [journalRow] = await sql<{ exists: boolean }[]>`
      select pg_catalog.to_regclass(${`public.${journal}`}) is not null as exists
    `;

    if (!journalRow?.exists) {
      result.missing.push(...plan.modules.map((module) => module.name));
      result.missingTables.push(...sentinels.tables);
      return result;
    }

    const [contractRow] = await sql<{ v: number | null }[]>`
      select max(contract_version)::int as v from ${sql.unsafe(journalQ)}
    `;
    if (contractRow?.v != null) {
      result.databaseContractVersion = contractRow.v;
      if (!supported.includes(contractRow.v)) {
        result.contractVersionMismatch = true;
      }
    }

    for (const module of plan.modules) {
      const [row] = await sql<
        {
          version: number;
          checksum: string;
          raw_checksum: string;
        }[]
      >`
        select version, checksum, raw_checksum
        from ${sql.unsafe(journalQ)}
        where module_name = ${module.name}
      `;

      if (!row) {
        result.missing.push(module.name);
        continue;
      }

      if (
        row.version !== module.version ||
        row.checksum !== module.checksum ||
        row.raw_checksum !== module.rawChecksum
      ) {
        result.incompatible.push(module.name);
        continue;
      }

      result.applied.push(module.name);
    }

    for (const table of sentinels.tables) {
      const [row] = await sql<{ exists: boolean }[]>`
      select pg_catalog.to_regclass(${`public.${table}`}) is not null as exists
      `;
      if (!row?.exists) result.missingTables.push(table);
    }

    for (const column of sentinels.columns) {
      const { table, column: columnName } = splitColumnSentinel(column);
      const [row] = await sql<{ exists: boolean }[]>`
        select exists (
          select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name = ${table}
            and column_name = ${columnName}
        ) as exists
      `;
      if (!row?.exists) result.missingTables.push(column);
    }
  } finally {
    await sql.end();
  }

  result.compatible =
    result.missing.length === 0 &&
    result.incompatible.length === 0 &&
    result.missingTables.length === 0 &&
    !result.contractVersionMismatch;

  return result;
}
