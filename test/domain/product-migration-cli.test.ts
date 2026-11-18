import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { runMigrations as runLegacyMigrations } from "@/lib/db/migration-runner";
import {
  assertProductDatabaseCompatibility,
  checkProductDatabaseCompatibility,
  PRODUCT_SCHEMA_SENTINELS,
} from "@/lib/db/product-migrations/compatibility";
import { assertPostgresUrl, databaseUrl, EXPECTED_ROLE } from "./helpers";

const FRESH_DATABASE = "nexty_overnight_20261105_n3_cli_fresh";
const LEGACY_DATABASE = "nexty_overnight_20261105_n3_cli_legacy";
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

type IdentityGuard = (database: string, role: string) => void;
type SqlClient = ReturnType<typeof postgres>;

interface CliResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

interface MigrationJournalRow {
  name?: string;
  module_name?: string;
  version?: number;
  contract_version?: number;
  checksum: string;
  raw_checksum?: string;
}

interface ProfileRow {
  profile_name: string;
}

interface RelationRow {
  relation_name: string;
  relation_kind: string;
}

interface EnumRow {
  type_name: string;
  labels: string[];
}

interface DatabaseSnapshot {
  productJournal: MigrationJournalRow[] | null;
  productProfiles: ProfileRow[] | null;
  legacyJournal: MigrationJournalRow[] | null;
  relations: RelationRow[];
  enums: EnumRow[];
}

function deriveDatabaseUrl(database: string): string {
  const url = new URL(databaseUrl());
  url.pathname = `/${database}`;
  return assertPostgresUrl(url.toString(), database);
}

function targetGuard(expectedDatabase: string): IdentityGuard {
  return (database, role) => {
    if (database !== expectedDatabase) {
      throw new Error(`拒绝在意外数据库 "${database}" 上执行回归；预期 "${expectedDatabase}"`);
    }
    if (role !== EXPECTED_ROLE) {
      throw new Error(`拒绝以意外角色 "${role}" 执行回归；预期 "${EXPECTED_ROLE}"`);
    }
  };
}

const FRESH_URL = deriveDatabaseUrl(FRESH_DATABASE);
const LEGACY_URL = deriveDatabaseUrl(LEGACY_DATABASE);
const assertFreshTarget = targetGuard(FRESH_DATABASE);
const assertLegacyTarget = targetGuard(LEGACY_DATABASE);

function cliEnvironment(databaseUrlValue: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    CI: "1",
    DATABASE_URL: databaseUrlValue,
    HUSKY: "0",
    NO_COLOR: "1",
    TURBO_TELEMETRY_DISABLED: "1",
  };

  for (const key of ["HOME", "TMPDIR", "LANG", "LC_ALL", "TERM"] as const) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }
  env.PATH = [path.dirname(process.execPath), process.env.PATH]
    .filter(Boolean)
    .join(path.delimiter);
  return env;
}

function runMigrationCli(databaseUrlValue: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["--filter", "@niu/web", "db:migrate"], {
      cwd: REPO_ROOT,
      env: cliEnvironment(databaseUrlValue),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function assertConnectionIdentity(sql: SqlClient, guard: IdentityGuard): Promise<void> {
  const [identity] = await sql<{ database: string; role: string }[]>`
    select current_database() as database, current_user as role
  `;
  if (!identity) {
    throw new Error("连接后未返回数据库与角色身份");
  }
  guard(identity.database, identity.role);
}

async function publicTableExists(sql: SqlClient, table: string): Promise<boolean> {
  const [row] = await sql<{ exists: boolean }[]>`
    select exists (
      select 1
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = ${table}
        and relation.relkind in ('r', 'p')
    ) as exists
  `;
  return row?.exists === true;
}

async function readDatabaseSnapshot(
  sql: SqlClient,
  guard: IdentityGuard,
): Promise<DatabaseSnapshot> {
  await assertConnectionIdentity(sql, guard);

  const productJournal = (await publicTableExists(sql, "_niu_migration_journal"))
    ? await sql<MigrationJournalRow[]>`
        select
          module_name,
          version::int as version,
          contract_version::int as contract_version,
          checksum,
          raw_checksum
        from public."_niu_migration_journal"
        order by module_name collate "C"
      `
    : null;
  const productProfiles = (await publicTableExists(sql, "_niu_migration_profile"))
    ? await sql<ProfileRow[]>`
        select profile_name
        from public."_niu_migration_profile"
        order by profile_name collate "C"
      `
    : null;
  const legacyJournal = (await publicTableExists(sql, "_n2_migration_journal"))
    ? await sql<MigrationJournalRow[]>`
        select name, checksum
        from public."_n2_migration_journal"
        order by name collate "C"
      `
    : null;
  const relations = await sql<RelationRow[]>`
    select relation.relname as relation_name, relation.relkind::text as relation_kind
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
    order by relation.relname collate "C", relation.relkind
  `;
  const enums = await sql<EnumRow[]>`
    select
      enum_type.typname as type_name,
      array_agg(enum_value.enumlabel order by enum_value.enumsortorder)::text[] as labels
    from pg_catalog.pg_type as enum_type
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = enum_type.typnamespace
    join pg_catalog.pg_enum as enum_value
      on enum_value.enumtypid = enum_type.oid
    where namespace.nspname = 'public'
      and enum_type.typtype = 'e'
    group by enum_type.typname
    order by enum_type.typname collate "C"
  `;

  return {
    productJournal: productJournal ? Array.from(productJournal) : null,
    productProfiles: productProfiles ? Array.from(productProfiles) : null,
    legacyJournal: legacyJournal ? Array.from(legacyJournal) : null,
    relations: Array.from(relations),
    enums: Array.from(enums),
  };
}

async function resetDatabase(sql: SqlClient, guard: IdentityGuard): Promise<void> {
  await assertConnectionIdentity(sql, guard);
  await sql.unsafe("drop schema public cascade; create schema public;");
}

async function seedLegacyChain(sql: SqlClient): Promise<void> {
  await resetDatabase(sql, assertLegacyTarget);
  const report = await runLegacyMigrations({ url: LEGACY_URL, guard: assertLegacyTarget });
  assert.equal(report.applied.length, 3, "真实旧链演练必须应用冻结的三个 _n2 迁移");
}

test("产品迁移 CLI 与启动兼容检查", async (t) => {
  const freshSql = postgres(FRESH_URL, { max: 1 });
  const legacySql = postgres(LEGACY_URL, { max: 1 });
  t.after(async () => {
    await Promise.all([freshSql.end(), legacySql.end()]);
  });

  await t.test("产品 CLI 在全新库只建立 _niu 元数据", async () => {
    await resetDatabase(freshSql, assertFreshTarget);

    const result = await runMigrationCli(FRESH_URL);
    assert.equal(
      result.code,
      0,
      `产品 CLI 应成功退出\nsignal: ${result.signal}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );

    const snapshot = await readDatabaseSnapshot(freshSql, assertFreshTarget);
    assert.equal(snapshot.productJournal?.length, 5, "CLI 必须记录全部五个 _niu 模块");
    assert.deepEqual(snapshot.productProfiles, [{ profile_name: "nano_payments_cms" }]);
    assert.equal(snapshot.legacyJournal, null, "全新库不得写入 _n2 元数据");
  });

  await t.test("兼容检查通过正常库且不修改 journal 或物理对象", async () => {
    const before = await readDatabaseSnapshot(freshSql, assertFreshTarget);
    const result = await assertProductDatabaseCompatibility(FRESH_URL);
    const after = await readDatabaseSnapshot(freshSql, assertFreshTarget);

    assert.equal(result.compatible, true);
    assert.deepEqual(after, before, "只读兼容检查不得修改 journal 或 public 物理对象");
  });

  await t.test("兼容检查要求逐模块 contract version 与 profile activation", async () => {
    await assertConnectionIdentity(freshSql, assertFreshTarget);
    await freshSql`
      update public."_niu_migration_journal"
      set contract_version = 0
      where module_name = 'auth'
    `;
    const beforeContractCheck = await readDatabaseSnapshot(freshSql, assertFreshTarget);
    const contractCheck = await checkProductDatabaseCompatibility(FRESH_URL);
    assert.equal(contractCheck.compatible, false);
    assert.ok(contractCheck.incompatible.includes("auth"));
    assert.deepEqual(
      await readDatabaseSnapshot(freshSql, assertFreshTarget),
      beforeContractCheck,
      "contract version 拒绝后不得修改 journal 或物理对象",
    );

    await freshSql`
      update public."_niu_migration_journal"
      set contract_version = 1
      where module_name = 'auth'
    `;
    await freshSql`delete from public."_niu_migration_profile"`;
    const beforeProfileCheck = await readDatabaseSnapshot(freshSql, assertFreshTarget);
    const profileCheck = await checkProductDatabaseCompatibility(FRESH_URL);
    assert.equal(profileCheck.compatible, false);
    assert.ok(profileCheck.incompatible.includes("profile:nano_payments_cms"));
    assert.deepEqual(
      await readDatabaseSnapshot(freshSql, assertFreshTarget),
      beforeProfileCheck,
      "profile activation 拒绝后不得修改 journal 或物理对象",
    );

    await freshSql`
      insert into public."_niu_migration_profile" (profile_name)
      values ('unexpected_profile')
    `;
    const beforeWrongProfileCheck = await readDatabaseSnapshot(freshSql, assertFreshTarget);
    const wrongProfileCheck = await checkProductDatabaseCompatibility(FRESH_URL);
    assert.equal(wrongProfileCheck.compatible, false);
    assert.ok(wrongProfileCheck.incompatible.includes("profile:nano_payments_cms"));
    assert.deepEqual(
      await readDatabaseSnapshot(freshSql, assertFreshTarget),
      beforeWrongProfileCheck,
      "错误 profile activation 拒绝后不得修改 journal 或物理对象",
    );

    await freshSql`delete from public."_niu_migration_profile"`;
    await freshSql`
      insert into public."_niu_migration_profile" (profile_name)
      values ('nano_payments_cms')
    `;
  });

  await t.test("兼容检查拒绝同名 view 且保持只读", async () => {
    await assertConnectionIdentity(freshSql, assertFreshTarget);
    await freshSql.unsafe(`
      alter table public.feedback_replies rename to feedback_replies_sentinel_source;
      create view public.feedback_replies as
        select * from public.feedback_replies_sentinel_source;
    `);
    const before = await readDatabaseSnapshot(freshSql, assertFreshTarget);

    const result = await checkProductDatabaseCompatibility(FRESH_URL);
    assert.equal(result.compatible, false);
    assert.ok(result.missingTables.includes("feedback_replies"));
    await assert.rejects(
      () => assertProductDatabaseCompatibility(FRESH_URL),
      /compatibility check failed safely:.*feedback_replies/,
    );

    const after = await readDatabaseSnapshot(freshSql, assertFreshTarget);
    assert.deepEqual(after, before, "拒绝同名 view 后不得修改 journal 或 public 物理对象");
  });

  await t.test("真实旧链改动后 CLI 拒绝接管且不写 _niu 账本", async () => {
    await seedLegacyChain(legacySql);
    await assertConnectionIdentity(legacySql, assertLegacyTarget);
    await legacySql.unsafe(`
      alter table public.feedback_replies rename to feedback_replies_contract_drift
    `);
    const before = await readDatabaseSnapshot(legacySql, assertLegacyTarget);
    assert.equal(before.legacyJournal?.length, 3);
    assert.equal(before.productJournal, null);

    const result = await runMigrationCli(LEGACY_URL);
    assert.equal(result.code, 1, "结构漂移的旧库必须被 takeover 协议拒绝");
    assert.match(result.stderr, /Product migration failed safely/);
    assert.ok(!result.stderr.includes("postgresql://"), "CLI 错误日志不得泄露连接串");

    const after = await readDatabaseSnapshot(legacySql, assertLegacyTarget);
    assert.deepEqual(after, before, "接管拒绝后 _n2 与物理对象必须保持原样且不得写 _niu");
  });

  await t.test("真实旧链演练后 CLI 接管并保留两代账本", async () => {
    await seedLegacyChain(legacySql);
    const before = await readDatabaseSnapshot(legacySql, assertLegacyTarget);
    assert.equal(before.legacyJournal?.length, 3);
    assert.equal(before.productJournal, null);

    const result = await runMigrationCli(LEGACY_URL);
    assert.equal(
      result.code,
      0,
      `旧库接管应成功退出\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );

    const after = await readDatabaseSnapshot(legacySql, assertLegacyTarget);
    assert.deepEqual(after.legacyJournal, before.legacyJournal, "_n2 账本必须逐行保留");
    assert.equal(after.productJournal?.length, 5, "接管必须回填完整 _niu journal");
    assert.deepEqual(after.productProfiles, [{ profile_name: "nano_payments_cms" }]);

    for (const table of PRODUCT_SCHEMA_SENTINELS.tables) {
      assert.ok(await publicTableExists(legacySql, table), `${table} 必须是真实表`);
    }
    assert.equal((await assertProductDatabaseCompatibility(LEGACY_URL)).compatible, true);
  });
});
