import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { captureMigrationSchemaContract } from "@sunpcm/niu-persistence-pg/migrations";
import postgres from "postgres";
import { runMigrations as runLegacyMigrations } from "@/lib/db/migration-runner";
import {
  assertProductDatabaseCompatibility,
  checkProductDatabaseCompatibility,
  PRODUCT_SCHEMA_SENTINELS,
  productMigrationOptions,
} from "@/lib/db/product-migrations/compatibility";
import {
  PRODUCT_LEGACY_JOURNAL,
  PRODUCT_LEGACY_SCHEMA_CONTRACT,
} from "@/lib/db/product-migrations/legacy-contract";
import { assertPostgresUrl, databaseUrl, EXPECTED_ROLE } from "./helpers";

const FRESH_DATABASE = "nexty_overnight_20261105_n3_cli_fresh";
const LEGACY_DATABASE = "nexty_overnight_20261105_n3_cli_legacy";
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PRODUCT_METADATA_PHYSICAL_SCHEMA = "product_metadata_physical";
const LEGACY_JOURNAL_PHYSICAL_SCHEMA = "legacy_journal_physical";

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

interface ForeignKeyTriggerRow {
  trigger_name: string;
  constraint_name: string;
  enabled: string;
}

interface PublicRelationIdentity {
  relation_name: string;
  relation_oid: string;
  relation_kind: string;
  definition: string | null;
}

interface ProductJournalPhysicalRow {
  module_name: string;
  version: number;
  contract_version: number;
  checksum: string;
  raw_checksum: string;
  applied_at: Date;
}

interface ProductProfilePhysicalRow {
  profile_name: string;
  applied_at: Date;
}

interface ProductMetadataRows {
  journal: ProductJournalPhysicalRow[];
  profiles: ProductProfilePhysicalRow[];
}

interface LegacyJournalPhysicalRow {
  name: string;
  checksum: string;
  applied_at: Date;
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
  await sql.unsafe(`
    drop schema if exists ${quoteIdentifier(PRODUCT_METADATA_PHYSICAL_SCHEMA)} cascade;
    drop schema if exists ${quoteIdentifier(LEGACY_JOURNAL_PHYSICAL_SCHEMA)} cascade;
    drop schema public cascade;
    create schema public;
  `);
}

async function seedLegacyChain(sql: SqlClient): Promise<void> {
  await resetDatabase(sql, assertLegacyTarget);
  const report = await runLegacyMigrations({ url: LEGACY_URL, guard: assertLegacyTarget });
  assert.equal(report.applied.length, 3, "真实旧链演练必须应用冻结的三个 _n2 迁移");
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function readFeedbackReplyForeignKeyTriggers(
  sql: SqlClient,
  guard: IdentityGuard,
): Promise<ForeignKeyTriggerRow[]> {
  await assertConnectionIdentity(sql, guard);
  const rows = await sql<ForeignKeyTriggerRow[]>`
    select
      trigger_record.tgname as trigger_name,
      constraint_record.conname as constraint_name,
      trigger_record.tgenabled::text as enabled
    from pg_catalog.pg_trigger as trigger_record
    join pg_catalog.pg_constraint as constraint_record
      on constraint_record.oid = trigger_record.tgconstraint
    where trigger_record.tgrelid = 'public.feedback_replies'::regclass
      and trigger_record.tgisinternal
      and constraint_record.contype = 'f'
    order by trigger_record.tgname collate "C"
  `;
  return Array.from(rows);
}

async function readPublicRelationIdentities(
  sql: SqlClient,
  guard: IdentityGuard,
): Promise<PublicRelationIdentity[]> {
  await assertConnectionIdentity(sql, guard);
  const rows = await sql<PublicRelationIdentity[]>`
    select
      relation.relname as relation_name,
      relation.oid::text as relation_oid,
      relation.relkind::text as relation_kind,
      case
        when relation.relkind in ('v', 'm')
          then pg_catalog.pg_get_viewdef(relation.oid, true)
        else null
      end as definition
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        '_niu_migration_journal',
        '_niu_migration_profile',
        '_n2_migration_journal'
      )
    order by relation.relname collate "C"
  `;
  return Array.from(rows);
}

async function readProductMetadataRows(
  sql: SqlClient,
  guard: IdentityGuard,
  source: "public" | "physical",
): Promise<ProductMetadataRows> {
  await assertConnectionIdentity(sql, guard);
  const journal =
    source === "public"
      ? await sql<ProductJournalPhysicalRow[]>`
          select
            module_name,
            version::int as version,
            contract_version::int as contract_version,
            checksum,
            raw_checksum,
            applied_at
          from public."_niu_migration_journal"
          order by module_name collate "C"
        `
      : await sql<ProductJournalPhysicalRow[]>`
          select
            module_name,
            version::int as version,
            contract_version::int as contract_version,
            checksum,
            raw_checksum,
            applied_at
          from product_metadata_physical."_niu_migration_journal"
          order by module_name collate "C"
        `;
  const profiles =
    source === "public"
      ? await sql<ProductProfilePhysicalRow[]>`
          select profile_name, applied_at
          from public."_niu_migration_profile"
          order by profile_name collate "C"
        `
      : await sql<ProductProfilePhysicalRow[]>`
          select profile_name, applied_at
          from product_metadata_physical."_niu_migration_profile"
          order by profile_name collate "C"
        `;
  return {
    journal: Array.from(journal),
    profiles: Array.from(profiles),
  };
}

async function readLegacyJournalRows(
  sql: SqlClient,
  guard: IdentityGuard,
  source: "public" | "physical",
): Promise<LegacyJournalPhysicalRow[]> {
  await assertConnectionIdentity(sql, guard);
  const rows =
    source === "public"
      ? await sql<LegacyJournalPhysicalRow[]>`
          select name, checksum, applied_at
          from public."_n2_migration_journal"
          order by name collate "C"
        `
      : await sql<LegacyJournalPhysicalRow[]>`
          select name, checksum, applied_at
          from legacy_journal_physical."_n2_migration_journal"
          order by name collate "C"
        `;
  return Array.from(rows);
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

  await t.test("真实 CLI 拒绝缺失产品表且不修改已应用账本或缺失状态", async () => {
    await resetDatabase(freshSql, assertFreshTarget);
    const initialize = await runMigrationCli(FRESH_URL);
    assert.equal(
      initialize.code,
      0,
      `合成库初始化应成功\nstdout:\n${initialize.stdout}\nstderr:\n${initialize.stderr}`,
    );

    await assertConnectionIdentity(freshSql, assertFreshTarget);
    await freshSql`drop table public.feedback_replies`;
    const before = await readDatabaseSnapshot(freshSql, assertFreshTarget);
    assert.equal(before.productJournal?.length, 5);
    assert.deepEqual(before.productProfiles, [{ profile_name: "nano_payments_cms" }]);
    assert.equal(await publicTableExists(freshSql, "feedback_replies"), false);

    const compatibility = await checkProductDatabaseCompatibility(FRESH_URL);
    assert.equal(compatibility.compatible, false);
    assert.ok(compatibility.missingTables.includes("feedback_replies"));

    const result = await runMigrationCli(FRESH_URL);
    assert.equal(
      result.code,
      1,
      `真实 CLI 必须拒绝缺表的已应用库\nsignal: ${result.signal}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.match(result.stderr, /Product migration failed safely/);
    assert.ok(!result.stderr.includes("postgresql://"), "CLI 错误日志不得泄露连接串");

    const after = await readDatabaseSnapshot(freshSql, assertFreshTarget);
    assert.deepEqual(after, before, "缺表拒绝后 _niu 元数据、缺失表及其他错误对象必须保持原样");
  });

  await t.test("兼容检查拒绝同名 view 且保持只读", async () => {
    await resetDatabase(freshSql, assertFreshTarget);
    const initialize = await runMigrationCli(FRESH_URL);
    assert.equal(
      initialize.code,
      0,
      `同名 view 回归前应能初始化合成库\nstdout:\n${initialize.stdout}\nstderr:\n${initialize.stderr}`,
    );

    await assertConnectionIdentity(freshSql, assertFreshTarget);
    await freshSql.unsafe(`
      alter table public.feedback_replies rename to feedback_replies_sentinel_source;
      create view public.feedback_replies as
        select * from public.feedback_replies_sentinel_source;
    `);
    const before = await readDatabaseSnapshot(freshSql, assertFreshTarget);

    const cliResult = await runMigrationCli(FRESH_URL);
    assert.equal(
      cliResult.code,
      1,
      `真实 CLI 不得把同名 view 当作产品表\nstdout:\n${cliResult.stdout}\nstderr:\n${cliResult.stderr}`,
    );

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

  await t.test("真实 CLI 拒绝旧链反馈回复表禁用内部外键触发器", async () => {
    await seedLegacyChain(legacySql);

    const frozenContract = await captureMigrationSchemaContract(
      productMigrationOptions(LEGACY_URL),
    );
    assert.deepEqual(
      frozenContract,
      PRODUCT_LEGACY_SCHEMA_CONTRACT,
      "完整旧链必须先匹配冻结 PG16 结构指纹",
    );
    const frozenLegacyJournal = await readDatabaseSnapshot(legacySql, assertLegacyTarget);
    assert.deepEqual(
      frozenLegacyJournal.legacyJournal,
      PRODUCT_LEGACY_JOURNAL,
      "真实旧链账本必须先匹配冻结迁移身份",
    );

    const foreignKeyTriggers = await readFeedbackReplyForeignKeyTriggers(
      legacySql,
      assertLegacyTarget,
    );
    const trigger = foreignKeyTriggers.find(({ enabled }) => enabled === "O");
    assert.ok(trigger, "完整 PG16 旧链必须包含 origin 生效的内部外键触发器");
    await assertConnectionIdentity(legacySql, assertLegacyTarget);
    await legacySql.unsafe(
      `alter table public.feedback_replies disable trigger ${quoteIdentifier(trigger.trigger_name)}`,
    );

    const disabledTriggers = await readFeedbackReplyForeignKeyTriggers(
      legacySql,
      assertLegacyTarget,
    );
    assert.equal(
      disabledTriggers.find(({ trigger_name }) => trigger_name === trigger.trigger_name)?.enabled,
      "D",
      "回归必须保留 origin 下被禁用的内部外键触发器状态",
    );

    const contractAfterDisable = await captureMigrationSchemaContract(
      productMigrationOptions(LEGACY_URL),
    );
    assert.deepEqual(
      contractAfterDisable,
      frozenContract,
      "内部外键触发器执行状态必须独立核对，不能改写冻结结构指纹",
    );

    const before = await readDatabaseSnapshot(legacySql, assertLegacyTarget);
    assert.equal(before.productJournal, null);
    assert.equal(before.productProfiles, null);

    const result = await runMigrationCli(LEGACY_URL);
    assert.equal(
      result.code,
      1,
      `真实 CLI 必须拒绝 origin 下外键触发器被禁用的旧库\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.match(result.stderr, /Product migration failed safely/);
    assert.ok(!result.stderr.includes("postgresql://"), "CLI 错误日志不得泄露连接串");

    const after = await readDatabaseSnapshot(legacySql, assertLegacyTarget);
    assert.deepEqual(
      after,
      before,
      "拒绝后旧账本、业务物理对象及两张 _niu 元数据缺失状态必须保持原样",
    );
    const afterTriggers = await readFeedbackReplyForeignKeyTriggers(legacySql, assertLegacyTarget);
    assert.equal(
      afterTriggers.find(({ trigger_name }) => trigger_name === trigger.trigger_name)?.enabled,
      "D",
      "拒绝接管后禁用触发器必须保持禁用",
    );
  });

  await t.test("初始 _n2 账本为同名 view 时真实 CLI 拒绝且不建 _niu 账本", async () => {
    await seedLegacyChain(legacySql);
    await assertConnectionIdentity(legacySql, assertLegacyTarget);
    await legacySql.unsafe(`
      create schema ${quoteIdentifier(LEGACY_JOURNAL_PHYSICAL_SCHEMA)};
      alter table public."_n2_migration_journal"
        set schema ${quoteIdentifier(LEGACY_JOURNAL_PHYSICAL_SCHEMA)};
      create view public."_n2_migration_journal" as
        select *
        from ${quoteIdentifier(LEGACY_JOURNAL_PHYSICAL_SCHEMA)}."_n2_migration_journal";
    `);

    const before = await readDatabaseSnapshot(legacySql, assertLegacyTarget);
    const relationsBefore = await readPublicRelationIdentities(legacySql, assertLegacyTarget);
    const publicJournalBefore = await readLegacyJournalRows(
      legacySql,
      assertLegacyTarget,
      "public",
    );
    const physicalJournalBefore = await readLegacyJournalRows(
      legacySql,
      assertLegacyTarget,
      "physical",
    );
    assert.deepEqual(publicJournalBefore, physicalJournalBefore, "同名 view 必须原样返回实际行");
    assert.equal(
      relationsBefore.find(({ relation_name }) => relation_name === "_n2_migration_journal")
        ?.relation_kind,
      "v",
      "public._n2_migration_journal 必须是回归构造的 view",
    );

    const result = await runMigrationCli(LEGACY_URL);
    assert.equal(
      result.code,
      1,
      `真实 CLI 不得把旧 journal 同名 view 当作可接管表\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.match(result.stderr, /Product migration failed safely/);

    const after = await readDatabaseSnapshot(legacySql, assertLegacyTarget);
    assert.deepEqual(
      after,
      before,
      "拒绝旧 journal view 后 public 关系、旧实际表和 _niu 缺失状态必须保持原样",
    );
    assert.equal(after.productJournal, null, "拒绝时不得创建 _niu journal");
    assert.equal(after.productProfiles, null, "拒绝时不得创建 _niu profile");
    assert.deepEqual(
      await readPublicRelationIdentities(legacySql, assertLegacyTarget),
      relationsBefore,
      "旧 journal view 的 OID、类型和定义不得改变",
    );
    assert.deepEqual(
      await readLegacyJournalRows(legacySql, assertLegacyTarget, "physical"),
      physicalJournalBefore,
      "非 public 的旧 journal 实表行不得改变",
    );
    assert.deepEqual(
      await readLegacyJournalRows(legacySql, assertLegacyTarget, "public"),
      publicJournalBefore,
      "public 同名 view 返回的行不得改变",
    );
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

    await assertConnectionIdentity(legacySql, assertLegacyTarget);
    await legacySql.unsafe(`
      create schema ${quoteIdentifier(PRODUCT_METADATA_PHYSICAL_SCHEMA)};
      alter table public."_niu_migration_journal"
        set schema ${quoteIdentifier(PRODUCT_METADATA_PHYSICAL_SCHEMA)};
      alter table public."_niu_migration_profile"
        set schema ${quoteIdentifier(PRODUCT_METADATA_PHYSICAL_SCHEMA)};
      create view public."_niu_migration_journal" as
        select *
        from ${quoteIdentifier(PRODUCT_METADATA_PHYSICAL_SCHEMA)}."_niu_migration_journal";
      create view public."_niu_migration_profile" as
        select *
        from ${quoteIdentifier(PRODUCT_METADATA_PHYSICAL_SCHEMA)}."_niu_migration_profile";
    `);

    const relationsBeforeMetadataViews = await readPublicRelationIdentities(
      legacySql,
      assertLegacyTarget,
    );
    const publicMetadataBefore = await readProductMetadataRows(
      legacySql,
      assertLegacyTarget,
      "public",
    );
    const physicalMetadataBefore = await readProductMetadataRows(
      legacySql,
      assertLegacyTarget,
      "physical",
    );
    assert.deepEqual(
      publicMetadataBefore,
      physicalMetadataBefore,
      "同名 view 必须原样返回非 public 实表中的两代产品元数据行",
    );
    for (const relation of ["_niu_migration_journal", "_niu_migration_profile"]) {
      assert.equal(
        relationsBeforeMetadataViews.find(({ relation_name }) => relation_name === relation)
          ?.relation_kind,
        "v",
        `public.${relation} 必须是回归构造的 view`,
      );
    }
    const beforeMetadataViews = await readDatabaseSnapshot(legacySql, assertLegacyTarget);

    const compatibility = await checkProductDatabaseCompatibility(LEGACY_URL);
    assert.equal(compatibility.compatible, false, "启动检查必须拒绝伪装产品元数据的 view");
    await assert.rejects(
      () => assertProductDatabaseCompatibility(LEGACY_URL),
      /compatibility check failed safely/,
    );

    const cliResult = await runMigrationCli(LEGACY_URL);
    assert.equal(
      cliResult.code,
      1,
      `真实 CLI 不得把 _niu 元数据同名 view 当作实际表\nstdout:\n${cliResult.stdout}\nstderr:\n${cliResult.stderr}`,
    );
    assert.match(cliResult.stderr, /Product migration failed safely/);
    assert.ok(!cliResult.stderr.includes("postgresql://"), "CLI 错误日志不得泄露连接串");

    assert.deepEqual(
      await readDatabaseSnapshot(legacySql, assertLegacyTarget),
      beforeMetadataViews,
      "拒绝对接 _niu view 后 public 关系、账本和产品物理对象必须保持原样",
    );
    assert.deepEqual(
      await readPublicRelationIdentities(legacySql, assertLegacyTarget),
      relationsBeforeMetadataViews,
      "_niu view 的 OID、类型和定义不得改变",
    );
    assert.deepEqual(
      await readProductMetadataRows(legacySql, assertLegacyTarget, "physical"),
      physicalMetadataBefore,
      "非 public 的 _niu 实表行不得改变",
    );
    assert.deepEqual(
      await readProductMetadataRows(legacySql, assertLegacyTarget, "public"),
      publicMetadataBefore,
      "public 的 _niu 同名 view 返回行不得改变",
    );
  });
});
