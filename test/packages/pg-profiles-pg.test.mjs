import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import {
  ALL_MODULES,
  checkProfileCompatibility,
  runMigrations,
} from "../../packages/persistence-pg/dist/migrations/index.js";

const url = process.env.PG_PROFILES_TEST_URL?.trim();
const expectedDatabase = process.env.PG_PROFILES_TEST_EXPECTED_DATABASE?.trim();
const expectedRole = process.env.PG_PROFILES_TEST_EXPECTED_ROLE?.trim();

const REQUIRED_ROLE = "nexty_overnight_test";
const FORBIDDEN_DATABASE_RE = /(reference|disposable|n2)/i;

function assertTestConfig() {
  if (!url) return;
  if (!expectedDatabase || !expectedRole) {
    throw new Error(
      "PG_PROFILES_TEST_URL is set, but PG_PROFILES_TEST_EXPECTED_DATABASE and " +
        "PG_PROFILES_TEST_EXPECTED_ROLE are required. Refusing to run without a " +
        "database/role identity guard.",
    );
  }
  if (expectedRole !== REQUIRED_ROLE) {
    throw new Error(
      `PG_PROFILES_TEST_EXPECTED_ROLE must be ${REQUIRED_ROLE} for the N3 dedicated ` +
        `database, got ${expectedRole}.`,
    );
  }
  if (FORBIDDEN_DATABASE_RE.test(expectedDatabase)) {
    throw new Error(
      `PG_PROFILES_TEST_EXPECTED_DATABASE ${expectedDatabase} matches a forbidden ` +
        "reference/N2/disposable database name.",
    );
  }
}

assertTestConfig();

function assertExpectedIdentity(database, role) {
  if (database !== expectedDatabase) {
    throw new Error(`wrong database: expected ${expectedDatabase}, got ${database}`);
  }
  if (role !== expectedRole) {
    throw new Error(`wrong role: expected ${expectedRole}, got ${role}`);
  }
}

function makeGuard() {
  return assertExpectedIdentity;
}

async function assertConnectionIdentity(sql) {
  const [row] = await sql`select current_database() as database, current_user as role`;
  assertExpectedIdentity(row.database, row.role);
}

async function publicTableCount(sql) {
  const [row] = await sql`select count(*)::int as n from pg_tables where schemaname = 'public'`;
  return row.n;
}

async function resetDatabase(sql) {
  // Guard the destructive reset itself; do not rely on the caller ordering a
  // guarded migrate before it.
  await assertConnectionIdentity(sql);
  await sql.unsafe(`
    do $$
    declare r record;
    begin
      for r in (select tablename from pg_tables where schemaname = 'public') loop
        execute 'drop table if exists "public"."' || r.tablename || '" cascade';
      end loop;
      for r in (
        select t.typname
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' and t.typtype = 'e'
      ) loop
        execute 'drop type if exists "public"."' || r.typname || '" cascade';
      end loop;
    end
    $$
  `);
}

async function journalRows(sql) {
  const rows = await sql`
    select module_name, version, contract_version, checksum, raw_checksum
    from "_niu_migration_journal"
    order by module_name
  `;
  return Object.fromEntries(rows.map((r) => [r.module_name, r]));
}

function moduleNamed(name, overrides = {}) {
  const base = ALL_MODULES.find((m) => m.name === name);
  if (!base) throw new Error(`unknown module ${name}`);
  return { ...base, ...overrides };
}

function creditsV2Module() {
  return {
    name: "credits_webhook_ledger",
    version: 1,
    contractVersion: 1,
    description: "append-only webhook ledger (test append upgrade)",
    dependencies: ["credits"],
    sql: 'CREATE TABLE "credits_webhook_ledger" (\n  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL\n);',
  };
}

test("PG migration profiles end-to-end", { skip: !url }, async (t) => {
  const guard = makeGuard();
  const sql = postgres(url, { max: 1 });
  t.after(async () => {
    await sql.end();
  });

  await t.test("new auth profile creates tables and records the profile", async () => {
    await resetDatabase(sql);
    const report = await runMigrations({ url, profile: "auth", guard });
    assert.deepEqual(report.applied, ["auth"]);
    assert.ok(report.verified.includes("user"));
    assert.ok(report.verified.includes("session.impersonated_by"));

    const check = await checkProfileCompatibility({ url, profile: "auth", guard });
    assert.equal(check.compatible, true);
    assert.deepEqual(check.applied, ["auth"]);
    assert.equal(check.databaseContractVersion, 1);
    assert.equal(check.contractVersionMismatch, false);

    const [profileRow] = await sql`select profile_name from "_niu_migration_profile"`;
    assert.equal(profileRow.profile_name, "auth");
  });

  await t.test("new auth_credits profile applies the full billing/credits closure", async () => {
    await resetDatabase(sql);
    const report = await runMigrations({ url, profile: "auth_credits", guard });
    assert.deepEqual(report.applied, ["auth", "payments", "credits"]);

    const check = await checkProfileCompatibility({ url, profile: "auth_credits", guard });
    assert.equal(check.compatible, true);
    assert.deepEqual(check.applied, ["auth", "payments", "credits"]);
  });

  await t.test("repeat run is idempotent", async () => {
    await resetDatabase(sql);
    const first = await runMigrations({ url, profile: "auth", guard });
    assert.deepEqual(first.applied, ["auth"]);
    const second = await runMigrations({ url, profile: "auth", guard });
    assert.deepEqual(second.applied, []);
    assert.deepEqual(second.skipped, ["auth"]);
  });

  await t.test("concurrent runs serialize on the advisory lock", async () => {
    await resetDatabase(sql);
    const [a, b] = await Promise.all([
      runMigrations({ url, profile: "auth_credits", guard }),
      runMigrations({ url, profile: "auth_credits", guard }),
    ]);
    const applied = new Set([...a.applied, ...b.applied]);
    assert.deepEqual([...applied].sort(), ["auth", "credits", "payments"]);
    const skipped = new Set([...a.skipped, ...b.skipped]);
    assert.ok(skipped.size >= 1, "one of the two runs must observe already-applied modules");
  });

  await t.test("statement checksum drift rejects", async () => {
    await resetDatabase(sql);
    await runMigrations({ url, profile: "auth", guard });
    const drifted = moduleNamed("auth", {
      sql: 'CREATE TYPE "public"."user_role" AS ENUM(\'user\', \'admin\', \'superadmin\');\n--> statement-breakpoint\nCREATE TABLE "user" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL);',
    });
    await assert.rejects(
      () => runMigrations({ url, profile: "auth", modules: [drifted], roots: ["auth"], guard }),
      /statement checksum changed/,
    );
  });

  await t.test("raw checksum drift rejects with identical statements", async () => {
    await resetDatabase(sql);
    const rawBase = {
      name: "raw_drift",
      version: 1,
      contractVersion: 1,
      description: "raw checksum drift fixture",
      dependencies: [],
      sql: "create table raw_drift (id int); --> statement-breakpoint\ncreate table raw_drift_b (id int);",
    };
    await runMigrations({ url, profile: "raw_drift", modules: [rawBase], roots: ["raw_drift"], guard });

    const rawDrifted = {
      ...rawBase,
      sql: "  create table raw_drift (id int);\n--> statement-breakpoint\n  create table raw_drift_b (id int);",
    };
    await assert.rejects(
      () =>
        runMigrations({
          url,
          profile: "raw_drift",
          modules: [rawDrifted],
          roots: ["raw_drift"],
          guard,
        }),
      /raw checksum changed/,
    );
  });

  await t.test("guard rejection happens before any DDL", async () => {
    await resetDatabase(sql);
    const badGuard = () => {
      throw new Error("guard rejected before DDL");
    };
    await assert.rejects(
      () => runMigrations({ url, profile: "auth", guard: badGuard }),
      /guard rejected before DDL/,
    );

    const [journal] = await sql`select to_regclass('public._niu_migration_journal') as reg`;
    assert.equal(journal.reg, null, "journal must not be created before a rejected guard");
    const [user] = await sql`select to_regclass('public.user') as reg`;
    assert.equal(user.reg, null, "user table must not be created before a rejected guard");
  });

  await t.test("DDL failure rolls back the whole batch", async () => {
    await resetDatabase(sql);
    const bad = {
      name: "bad_ddl",
      version: 1,
      contractVersion: 1,
      description: "intentionally broken SQL",
      dependencies: [],
      sql: "CREATE TABLE broken_table (",
    };
    await assert.rejects(
      () =>
        runMigrations({
          url,
          profile: "bad_ddl",
          modules: [bad],
          roots: ["bad_ddl"],
          verifySchema: false,
          guard,
        }),
      /syntax error|ERROR/i,
    );
    const [table] = await sql`select to_regclass('public.broken_table') as reg`;
    assert.equal(table.reg, null);
    const [journal] = await sql`select to_regclass('public._niu_migration_journal') as reg`;
    assert.equal(journal.reg, null);
  });

  await t.test("journal write failure rolls back DDL atomically", async () => {
    await resetDatabase(sql);
    // A journal whose CHECK rejects auth: the module DDL succeeds, then the
    // journal insert fails, so the whole transaction must roll back.
    await sql.unsafe(`
      create table "_niu_migration_journal" (
        module_name text primary key,
        version integer not null,
        contract_version integer not null,
        checksum text not null,
        raw_checksum text not null,
        constraint no_auth check (module_name <> 'auth')
      )
    `);
    await assert.rejects(
      () => runMigrations({ url, profile: "auth", guard }),
      /no_auth|check/,
    );
    const [user] = await sql`select to_regclass('public.user') as reg`;
    assert.equal(user.reg, null, "user table must roll back with the failed journal write");
  });

  await t.test("first auth then add credits preserves the auth fingerprint", async () => {
    await resetDatabase(sql);
    await runMigrations({ url, profile: "auth", guard });
    const before = await journalRows(sql);
    const report = await runMigrations({ url, profile: "auth_credits", guard });
    assert.deepEqual(report.applied, ["payments", "credits"]);
    assert.deepEqual(report.skipped, ["auth"]);
    const after = await journalRows(sql);
    assert.deepEqual(after.auth, before.auth, "auth fingerprint must not change");
  });

  await t.test("close/restart is idempotent via a fresh connection", async () => {
    await resetDatabase(sql);
    await runMigrations({ url, profile: "auth_credits", guard });
    const reopened = postgres(url, { max: 1 });
    try {
      const report = await runMigrations({ url, profile: "auth_credits", guard });
      assert.deepEqual(report.applied, []);
      assert.deepEqual(report.skipped, ["auth", "payments", "credits"]);
    } finally {
      await reopened.end();
    }
  });

  await t.test("append upgrade adds only the new module and keeps old checksums", async () => {
    await resetDatabase(sql);
    await runMigrations({ url, profile: "auth_credits", guard });
    const before = await journalRows(sql);

    const v2 = creditsV2Module();
    const manifest = [...ALL_MODULES, v2];
    const roots = ["auth", "payments", "credits", v2.name];
    const report = await runMigrations({
      url,
      profile: "auth_credits_v2",
      modules: manifest,
      roots,
      guard,
    });
    assert.deepEqual(report.applied, [v2.name]);
    assert.deepEqual(report.skipped, ["auth", "payments", "credits"]);

    const after = await journalRows(sql);
    for (const name of ["auth", "payments", "credits"]) {
      assert.deepEqual(after[name], before[name], `${name} fingerprint must stay unchanged`);
    }
    assert.equal(after[v2.name].version, 1);
    assert.equal(after[v2.name].contract_version, 1);
  });

  await t.test("read-only compatibility check on empty DB is read-only", async () => {
    await resetDatabase(sql);
    const before = await publicTableCount(sql);

    const result = await checkProfileCompatibility({ url, profile: "auth", guard });
    assert.equal(result.compatible, false);
    assert.deepEqual(result.missing, ["auth"]);

    const after = await publicTableCount(sql);
    assert.equal(after, before, "compatibility check must not create tables");
  });

  await t.test("read-only compatibility check on migrated DB is read-only", async () => {
    await resetDatabase(sql);
    await runMigrations({ url, profile: "auth", guard });
    const before = await publicTableCount(sql);

    const result = await checkProfileCompatibility({ url, profile: "auth", guard });
    assert.equal(result.compatible, true);
    assert.deepEqual(result.applied, ["auth"]);

    const after = await publicTableCount(sql);
    assert.equal(after, before, "compatibility check must not create or drop tables");
  });

  await t.test("read-only compatibility check reports drifted journal as incompatible", async () => {
    await resetDatabase(sql);
    await runMigrations({ url, profile: "auth", guard });
    await sql`update "_niu_migration_journal" set checksum = 'deadbeef' where module_name = 'auth'`;

    const result = await checkProfileCompatibility({ url, profile: "auth", guard });
    assert.equal(result.compatible, false);
    assert.deepEqual(result.incompatible, ["auth"]);
    assert.equal(result.missingTables.length, 0);
  });

  await t.test("read-only compatibility check detects a missing declared table", async () => {
    await resetDatabase(sql);
    await runMigrations({ url, profile: "auth", guard });
    await sql.unsafe('drop table if exists "public"."user" cascade');

    const result = await checkProfileCompatibility({ url, profile: "auth", guard });
    assert.equal(result.compatible, false);
    assert.ok(
      result.missingTables.includes("user"),
      "declared auth table must be reported missing",
    );
  });

  await t.test("read-only compatibility check rejects missing auth member/account tables with a valid journal", async () => {
    await resetDatabase(sql);
    await runMigrations({ url, profile: "auth", guard });

    // Keep the journal intact but remove two required auth business tables.
    const before = await publicTableCount(sql);
    await sql.unsafe('drop table if exists "public"."member" cascade');
    await sql.unsafe('drop table if exists "public"."account" cascade');
    const afterDrop = await publicTableCount(sql);
    assert.ok(before - afterDrop >= 2, "member and account must actually be dropped");

    const result = await checkProfileCompatibility({ url, profile: "auth", guard });
    assert.equal(result.compatible, false);
    assert.ok(result.missingTables.includes("member"), "member table must be reported missing");
    assert.ok(result.missingTables.includes("account"), "account table must be reported missing");

    const afterCheck = await publicTableCount(sql);
    assert.equal(afterCheck, afterDrop, "compatibility check must not run DDL or recreate tables");
  });

  await t.test("read-only compatibility check rejects a breaking contract upgrade for an old consumer", async () => {
    await resetDatabase(sql);
    await runMigrations({ url, profile: "auth", guard });

    const breaking = {
      name: "auth_drop_banned",
      version: 1,
      contractVersion: 2,
      description: "breaking: drop user.banned",
      dependencies: ["auth"],
      sql: 'ALTER TABLE "public"."user" DROP COLUMN "banned";',
    };
    const manifest = [...ALL_MODULES, breaking];
    await runMigrations({
      url,
      profile: "auth_v2",
      modules: manifest,
      roots: ["auth", breaking.name],
      guard,
    });

    // Old consumer (auth profile, supports contract 1 only) must reject.
    const oldCheck = await checkProfileCompatibility({ url, profile: "auth", guard });
    assert.equal(oldCheck.compatible, false);
    assert.equal(oldCheck.contractVersionMismatch, true);
    assert.equal(oldCheck.databaseContractVersion, 2);

    // New consumer (supports contract 1 and 2) must accept.
    const newCheck = await checkProfileCompatibility({
      url,
      profile: "auth_v2",
      modules: manifest,
      roots: ["auth", breaking.name],
      guard,
    });
    assert.equal(newCheck.compatible, true);
    assert.equal(newCheck.contractVersionMismatch, false);
    assert.equal(newCheck.databaseContractVersion, 2);
  });
});
