import assert from "node:assert/strict";
import { before, test } from "node:test";
import postgres from "postgres";
import {
  checkMigrationCompatibility,
  runMigrations,
} from "@/lib/db/migration-runner";
import { defaultMigrationSource } from "@/lib/db/migration-source";
import type { JournalWrite, MigrationSource } from "@/lib/db/migration-types";
import {
  assertIsolatedTarget,
  assertPostgresUrl,
  databaseUrl,
  EXPECTED_ROLE,
} from "./helpers";

const C01_DATABASE = "nexty_overnight_20261105_migration_c01";
const FAULT_DATABASE = "nexty_overnight_20261105_migration_fault_c01";
const REFERENCE_DATABASE = "nexty_overnight_20261105_test";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set; migration tests need controller-injected PG runtime env`,
    );
  }
  return value;
}

// All four URLs are validated before any connection is opened: protocol,
// literal 127.0.0.1, controller port, exact pathname, and the fixed role.
const C01_URL = assertPostgresUrl(requireEnv("MIGRATION_C01_DATABASE_URL"), C01_DATABASE);
const FAULT_URL = assertPostgresUrl(requireEnv("MIGRATION_FAULT_DATABASE_URL"), FAULT_DATABASE);
const APP_URL = databaseUrl();
const REFERENCE_URL = assertPostgresUrl(requireEnv("N2_REFERENCE_DATABASE_URL"), REFERENCE_DATABASE);

function assertTaskTarget(
  actualDatabase: string,
  actualRole: string,
  expectedDatabase: string,
): void {
  if (actualDatabase !== expectedDatabase) {
    throw new Error(
      `Refusing to run against unexpected database "${actualDatabase}" (expected ${expectedDatabase})`,
    );
  }
  if (actualRole !== EXPECTED_ROLE) {
    throw new Error(
      `Refusing to run as unexpected role "${actualRole}" (expected ${EXPECTED_ROLE})`,
    );
  }
}

async function resetTaskDatabase(
  url: string,
  guard: (database: string, role: string) => void,
): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('nexty-n2-migration-reset'))`;
      const [row] = await tx<{ database: string; role: string }[]>`
        select current_database() as database, current_user as role
      `;
      guard(row.database, row.role);
      await tx.unsafe("drop schema if exists public cascade");
      await tx.unsafe("create schema public");
    });
  } finally {
    await sql.end();
  }
}

async function relationExists(url: string, name: string): Promise<boolean> {
  const sql = postgres(url, { max: 1 });
  try {
    const [row] = await sql<{ exists: boolean }[]>`
      select to_regclass(${name}) is not null as exists
    `;
    return row?.exists ?? false;
  } finally {
    await sql.end();
  }
}

async function journalNames(url: string): Promise<string[]> {
  const sql = postgres(url, { max: 1 });
  try {
    const rows = await sql<{ name: string }[]>`select name from _n2_migration_journal order by name`;
    return rows.map((row) => row.name);
  } finally {
    await sql.end();
  }
}

function memorySource(entries: Array<[string, string]>): MigrationSource {
  const map = new Map(entries);
  return {
    list: () => [...map.keys()],
    read: (name) => {
      const value = map.get(name);
      if (value === undefined) throw new Error(`Migration source missing file: ${name}`);
      return value;
    },
  };
}

const realEntries = defaultMigrationSource
  .list()
  .map((name): [string, string] => [name, defaultMigrationSource.read(name)]);

/** The two canonical entries that existed before the N4 Nano append. */
const LEGACY_REFERENCE_NAMES = defaultMigrationSource.list().slice(0, 2);

const legacyReferenceSource: MigrationSource = {
  list: () => [...LEGACY_REFERENCE_NAMES],
  read: (name) => defaultMigrationSource.read(name),
};

function driftSource(): MigrationSource {
  const [first, ...rest] = realEntries;
  return memorySource([[first[0], `${first[1]}\n-- injected drift\n`], ...rest]);
}

function ddlFailureSource(): MigrationSource {
  return memorySource([...realEntries, ["9999_broken.sql", "CREATE TABLE broken (;"]]);
}

const failingJournalWrite: JournalWrite = async () => {
  throw new Error("simulated journal write failure");
};

before(async () => {
  await resetTaskDatabase(APP_URL, assertIsolatedTarget);
  await resetTaskDatabase(C01_URL, (database, role) =>
    assertTaskTarget(database, role, C01_DATABASE),
  );
  await resetTaskDatabase(FAULT_URL, (database, role) =>
    assertTaskTarget(database, role, FAULT_DATABASE),
  );
});

test("fresh migration applies the full chain and verifies it", async () => {
  const report = await runMigrations({
    url: APP_URL,
    guard: assertIsolatedTarget,
  });

  assert.deepEqual(report.applied, realEntries.map(([name]) => name));
  assert.deepEqual(report.skipped, []);
  assert.deepEqual(report.verified, ["user", "session.impersonated_by"]);
  assert.equal(await relationExists(APP_URL, "user"), true);
  assert.deepEqual(await journalNames(APP_URL), realEntries.map(([name]) => name));
});

test("repeat migration is a no-op and keeps the journal identity", async () => {
  const report = await runMigrations({
    url: APP_URL,
    guard: assertIsolatedTarget,
  });

  assert.deepEqual(report.applied, []);
  assert.deepEqual(report.skipped, realEntries.map(([name]) => name));
  assert.deepEqual(await journalNames(APP_URL), realEntries.map(([name]) => name));
});

test("concurrent migrations serialize on the advisory lock and apply once", async () => {
  await resetTaskDatabase(C01_URL, (database, role) =>
    assertTaskTarget(database, role, C01_DATABASE),
  );

  const runners = Array.from({ length: 5 }, () =>
    runMigrations({
      url: C01_URL,
      guard: (database, role) => assertTaskTarget(database, role, C01_DATABASE),
    }),
  );

  const results = await Promise.all(runners);

  const applied = results.filter((report) => report.applied.length > 0);
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0].applied, realEntries.map(([name]) => name));
  assert.deepEqual(await journalNames(C01_URL), realEntries.map(([name]) => name));
});

test("checksum drift is rejected without rewriting the journal", async () => {
  await resetTaskDatabase(FAULT_URL, (database, role) =>
    assertTaskTarget(database, role, FAULT_DATABASE),
  );
  await runMigrations({
    url: FAULT_URL,
    guard: (database, role) => assertTaskTarget(database, role, FAULT_DATABASE),
  });

  await assert.rejects(
    () =>
      runMigrations({
        url: FAULT_URL,
        guard: (database, role) => assertTaskTarget(database, role, FAULT_DATABASE),
        source: driftSource(),
      }),
    /checksum changed/,
  );

  assert.deepEqual(await journalNames(FAULT_URL), realEntries.map(([name]) => name));
});

test("DDL failure rolls back the whole batch", async () => {
  await resetTaskDatabase(FAULT_URL, (database, role) =>
    assertTaskTarget(database, role, FAULT_DATABASE),
  );

  await assert.rejects(
    () =>
      runMigrations({
        url: FAULT_URL,
        guard: (database, role) => assertTaskTarget(database, role, FAULT_DATABASE),
        source: ddlFailureSource(),
      }),
    /syntax error|relation|ERROR/i,
  );

  assert.equal(await relationExists(FAULT_URL, "user"), false);
  assert.equal(await relationExists(FAULT_URL, "_n2_migration_journal"), false);
});

test("journal write failure rolls back the whole batch", async () => {
  await resetTaskDatabase(FAULT_URL, (database, role) =>
    assertTaskTarget(database, role, FAULT_DATABASE),
  );

  await assert.rejects(
    () =>
      runMigrations({
        url: FAULT_URL,
        guard: (database, role) => assertTaskTarget(database, role, FAULT_DATABASE),
        journalWrite: failingJournalWrite,
      }),
    /simulated journal write failure/,
  );

  assert.equal(await relationExists(FAULT_URL, "user"), false);
  assert.equal(await relationExists(FAULT_URL, "_n2_migration_journal"), false);
});

test("repair rerun succeeds after a fault", async () => {
  await resetTaskDatabase(FAULT_URL, (database, role) =>
    assertTaskTarget(database, role, FAULT_DATABASE),
  );

  const report = await runMigrations({
    url: FAULT_URL,
    guard: (database, role) => assertTaskTarget(database, role, FAULT_DATABASE),
  });

  assert.deepEqual(report.applied, realEntries.map(([name]) => name));
  assert.deepEqual(await journalNames(FAULT_URL), realEntries.map(([name]) => name));
});

test("reference database validates legacy compat without re-applying", async () => {
  const compat = await checkMigrationCompatibility({
    url: REFERENCE_URL,
    guard: (database, role) => assertTaskTarget(database, role, REFERENCE_DATABASE),
    source: legacyReferenceSource,
  });

  assert.equal(compat.compatible, true);
  assert.deepEqual(compat.applied, LEGACY_REFERENCE_NAMES);
  assert.deepEqual(compat.missing, []);
  assert.deepEqual(compat.incompatible, []);
  assert.deepEqual(compat.verified, ["user", "session.impersonated_by"]);
});
