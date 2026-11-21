import assert from "node:assert/strict";
import { test } from "node:test";
import postgres from "postgres";
import {
  captureMigrationSchemaContract,
  runMigrations as runProductMigrations,
  takeoverMigrations,
} from "@sunpcm/niu-persistence-pg/migrations";
import { PRODUCT_MIGRATION_PLAN } from "@/lib/db/product-migrations";
import { runMigrations as runLegacyMigrations } from "@/lib/db/migration-runner";
import { assertPostgresUrl, databaseUrl, EXPECTED_ROLE } from "./helpers";

const TAKEOVER_DATABASE = "nexty_overnight_20261105_n3_takeover";
const REFERENCE_DATABASE = "nexty_overnight_20261105_n3_takeover_reference";
const SYNTHETIC_TAG_ID = "00000000-0000-4000-8000-000000000001";
const EXPECTED_PRODUCT_MODULES = ["auth", "cms_feedback", "credits", "nano", "payments"] as const;

type IdentityGuard = (database: string, role: string) => void;
type SqlClient = ReturnType<typeof postgres>;

interface LegacyJournalRow {
  name: string;
  checksum: string;
  applied_at: Date;
}

interface ProductJournalRow {
  module_name: string;
  version: number;
  contract_version: number;
  checksum: string;
  raw_checksum: string;
  applied_at: Date;
}

interface ProfileRow {
  profile_name: string;
  applied_at: Date;
}

interface SyntheticTagSnapshot {
  table_oid: string;
  id: string;
  name: string;
  post_type: string;
  created_at: Date;
}

function deriveDatabaseUrl(database: string): string {
  const url = new URL(databaseUrl());
  url.pathname = `/${database}`;
  return assertPostgresUrl(url.toString(), database);
}

const TAKEOVER_URL = deriveDatabaseUrl(TAKEOVER_DATABASE);
const REFERENCE_URL = deriveDatabaseUrl(REFERENCE_DATABASE);

function makeTargetGuard(expectedDatabase: string): IdentityGuard {
  return (database, role) => {
    if (database !== expectedDatabase) {
      throw new Error(`拒绝在意外数据库 "${database}" 上执行迁移；预期 "${expectedDatabase}"`);
    }
    if (role !== EXPECTED_ROLE) {
      throw new Error(`拒绝以意外角色 "${role}" 执行迁移；预期 "${EXPECTED_ROLE}"`);
    }
  };
}

const assertTakeoverTarget = makeTargetGuard(TAKEOVER_DATABASE);
const assertReferenceTarget = makeTargetGuard(REFERENCE_DATABASE);

function sortedNames(names: readonly string[]): string[] {
  return [...names].sort();
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

async function readLegacyJournal(url: string, guard: IdentityGuard): Promise<LegacyJournalRow[]> {
  const sql = postgres(url, { max: 1 });
  try {
    await assertConnectionIdentity(sql, guard);
    return await sql<LegacyJournalRow[]>`
      select name, checksum, applied_at
      from public."_n2_migration_journal"
      order by name collate "C"
    `;
  } finally {
    await sql.end();
  }
}

async function readProductJournal(guard: IdentityGuard): Promise<ProductJournalRow[]> {
  const sql = postgres(TAKEOVER_URL, { max: 1 });
  try {
    await assertConnectionIdentity(sql, guard);
    return await sql<ProductJournalRow[]>`
      select
        module_name,
        version::int as version,
        contract_version::int as contract_version,
        checksum,
        raw_checksum,
        applied_at
      from public."_niu_migration_journal"
      order by module_name collate "C"
    `;
  } finally {
    await sql.end();
  }
}

async function readProfiles(guard: IdentityGuard): Promise<ProfileRow[]> {
  const sql = postgres(TAKEOVER_URL, { max: 1 });
  try {
    await assertConnectionIdentity(sql, guard);
    return await sql<ProfileRow[]>`
      select profile_name, applied_at
      from public."_niu_migration_profile"
      order by profile_name collate "C"
    `;
  } finally {
    await sql.end();
  }
}

async function readSyntheticTag(guard: IdentityGuard): Promise<SyntheticTagSnapshot> {
  const sql = postgres(TAKEOVER_URL, { max: 1 });
  try {
    await assertConnectionIdentity(sql, guard);
    const [snapshot] = await sql<SyntheticTagSnapshot[]>`
      select
        'public.tags'::regclass::oid::text as table_oid,
        id::text as id,
        name,
        post_type::text as post_type,
        created_at
      from public.tags
      where id = ${SYNTHETIC_TAG_ID}::uuid
    `;
    if (!snapshot) {
      throw new Error("合成 tags 行不存在");
    }
    return snapshot;
  } finally {
    await sql.end();
  }
}

async function readMetadataRelations(
  guard: IdentityGuard,
): Promise<{ journal: boolean; profile: boolean }> {
  const sql = postgres(TAKEOVER_URL, { max: 1 });
  try {
    await assertConnectionIdentity(sql, guard);
    const [relations] = await sql<{ journal: boolean; profile: boolean }[]>`
      select
        to_regclass('public._niu_migration_journal') is not null as journal,
        to_regclass('public._niu_migration_profile') is not null as profile
    `;
    if (!relations) {
      throw new Error("未能读取产品迁移元数据存在状态");
    }
    return relations;
  } finally {
    await sql.end();
  }
}

async function insertSyntheticTag(guard: IdentityGuard): Promise<void> {
  const sql = postgres(TAKEOVER_URL, { max: 1 });
  try {
    await assertConnectionIdentity(sql, guard);
    await sql`
      insert into public.tags (id, name, post_type, created_at)
      values (
        ${SYNTHETIC_TAG_ID}::uuid,
        'takeover-synthetic',
        'blog',
        '2026-11-18T00:00:00Z'::timestamptz
      )
    `;
  } finally {
    await sql.end();
  }
}

async function mutateTakeoverDatabase(
  guard: IdentityGuard,
  mutation: (sql: SqlClient) => Promise<unknown>,
): Promise<void> {
  const sql = postgres(TAKEOVER_URL, { max: 1 });
  try {
    await assertConnectionIdentity(sql, guard);
    await mutation(sql);
  } finally {
    await sql.end();
  }
}

function productMigrationOptions(url: string, guard: IdentityGuard) {
  return {
    url,
    profile: PRODUCT_MIGRATION_PLAN.profile.name,
    modules: PRODUCT_MIGRATION_PLAN.modules,
    roots: PRODUCT_MIGRATION_PLAN.roots,
    guard,
  } as const;
}

test("产品迁移在精确结构合同下接管旧链并保持两代账本", async (t) => {
  const legacyReport = await runLegacyMigrations({
    url: TAKEOVER_URL,
    guard: assertTakeoverTarget,
  });
  const expectedLegacyJournal = legacyReport.files
    .map(({ name, checksum }) => ({ name, checksum }))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  assert.ok(expectedLegacyJournal.length > 0, "旧 app runner 必须报告迁移文件");

  const actualLegacyJournal = await readLegacyJournal(TAKEOVER_URL, assertTakeoverTarget);
  assert.deepEqual(
    actualLegacyJournal.map(({ name, checksum }) => ({ name, checksum })),
    expectedLegacyJournal,
    "旧 _n2 账本必须与 runner 报告的完整文件指纹一致",
  );
  const legacyJournalBeforeTakeover = actualLegacyJournal;

  await insertSyntheticTag(assertTakeoverTarget);
  const syntheticTagBeforeTakeover = await readSyntheticTag(assertTakeoverTarget);

  const referenceReport = await runProductMigrations(
    productMigrationOptions(REFERENCE_URL, assertReferenceTarget),
  );
  assert.deepEqual(
    sortedNames(referenceReport.modules.map((module) => module.name)),
    [...EXPECTED_PRODUCT_MODULES],
    "参考库必须由真实 PRODUCT_MIGRATION_PLAN 解析出排序后的五个模块",
  );
  const referenceContract = await captureMigrationSchemaContract(
    productMigrationOptions(REFERENCE_URL, assertReferenceTarget),
  );
  assert.deepEqual(
    Object.keys(referenceContract).sort(),
    ["formatVersion", "modules", "postgresMajor", "profile", "schemaHash"],
    "公开 schemaContract 必须保持紧凑、可版本化的五字段形式",
  );
  assert.equal(referenceContract.formatVersion, 1);
  assert.equal(referenceContract.postgresMajor, 16);
  assert.equal(referenceContract.profile, PRODUCT_MIGRATION_PLAN.profile.name);
  const expectedContractModules = referenceReport.modules
    .map(({ name, version, contractVersion, checksum, rawChecksum }) => ({
      name,
      version,
      contractVersion,
      checksum,
      rawChecksum,
    }))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  assert.deepEqual(
    referenceContract.modules,
    expectedContractModules,
    "合同必须绑定全部已解析模块的版本与双重指纹",
  );
  assert.match(referenceContract.schemaHash, /^[a-f0-9]{64}$/);

  const takeoverOptions = {
    ...productMigrationOptions(TAKEOVER_URL, assertTakeoverTarget),
    schemaContract: referenceContract,
    legacyJournal: expectedLegacyJournal,
  } as const;

  await t.test("拒绝 public 中的非表/索引/序列 relation", async () => {
    await mutateTakeoverDatabase(assertTakeoverTarget, async (sql) => {
      await sql`create view public.takeover_probe_view as select 1::integer as value`;
    });
    try {
      await assert.rejects(
        () => takeoverMigrations(takeoverOptions),
        /Unsupported public relation.*takeover_probe_view\(v\)/,
      );
      assert.deepEqual(await readMetadataRelations(assertTakeoverTarget), {
        journal: false,
        profile: false,
      });
    } finally {
      await mutateTakeoverDatabase(assertTakeoverTarget, async (sql) => {
        await sql`drop view public.takeover_probe_view`;
      });
    }
    assert.deepEqual(await readSyntheticTag(assertTakeoverTarget), syntheticTagBeforeTakeover);
    assert.deepEqual(
      await readLegacyJournal(TAKEOVER_URL, assertTakeoverTarget),
      legacyJournalBeforeTakeover,
    );
  });

  await t.test("列 collation 与表 relpersistence 漂移均 fail closed", async () => {
    await mutateTakeoverDatabase(assertTakeoverTarget, async (sql) => {
      await sql`alter table public.tags alter column name type text collate "C"`;
    });
    try {
      await assert.rejects(
        () => takeoverMigrations({ ...takeoverOptions, verifySchema: false }),
        /schema contract mismatch: schemaHash/i,
      );
      assert.deepEqual(await readMetadataRelations(assertTakeoverTarget), {
        journal: false,
        profile: false,
      });
      assert.deepEqual(await readSyntheticTag(assertTakeoverTarget), syntheticTagBeforeTakeover);
    } finally {
      await mutateTakeoverDatabase(assertTakeoverTarget, async (sql) => {
        await sql`alter table public.tags alter column name type text collate pg_catalog."default"`;
      });
    }

    await mutateTakeoverDatabase(assertTakeoverTarget, async (sql) => {
      await sql`alter table public.verification set unlogged`;
    });
    try {
      await assert.rejects(
        () => takeoverMigrations({ ...takeoverOptions, verifySchema: false }),
        /schema contract mismatch: schemaHash/i,
      );
      assert.deepEqual(await readMetadataRelations(assertTakeoverTarget), {
        journal: false,
        profile: false,
      });
      assert.deepEqual(await readSyntheticTag(assertTakeoverTarget), syntheticTagBeforeTakeover);
    } finally {
      await mutateTakeoverDatabase(assertTakeoverTarget, async (sql) => {
        await sql`alter table public.verification set logged`;
      });
    }
    assert.deepEqual(
      await readLegacyJournal(TAKEOVER_URL, assertTakeoverTarget),
      legacyJournalBeforeTakeover,
    );
  });

  await t.test("错误旧 ref 与半份新账本都不得回写", async () => {
    await assert.rejects(
      () =>
        captureMigrationSchemaContract({
          ...productMigrationOptions(REFERENCE_URL, assertReferenceTarget),
          journalTable: "_niu_custom_migration_journal",
        }),
      /fixed public migration journal\/profile tables/,
    );
    assert.deepEqual(await readMetadataRelations(assertTakeoverTarget), {
      journal: false,
      profile: false,
    });

    await assert.rejects(
      () =>
        takeoverMigrations({
          ...takeoverOptions,
          profileTable: "_niu_custom_migration_profile",
        }),
      /fixed public migration journal\/profile tables/,
    );
    assert.deepEqual(await readMetadataRelations(assertTakeoverTarget), {
      journal: false,
      profile: false,
    });

    await assert.rejects(
      () =>
        takeoverMigrations({
          ...takeoverOptions,
          legacyJournal: [],
        }),
      /Legacy migration journal expectation is empty/,
    );
    assert.deepEqual(await readMetadataRelations(assertTakeoverTarget), {
      journal: false,
      profile: false,
    });

    const wrongReference = expectedLegacyJournal.map((row, index) =>
      index === 0 ? { ...row, checksum: "0".repeat(64) } : row,
    );
    await assert.rejects(
      () =>
        takeoverMigrations({
          ...takeoverOptions,
          legacyJournal: wrongReference,
        }),
      /Legacy migration journal is incomplete or has drifted fingerprints/,
    );
    assert.deepEqual(await readMetadataRelations(assertTakeoverTarget), {
      journal: false,
      profile: false,
    });

    await mutateTakeoverDatabase(assertTakeoverTarget, async (sql) => {
      await sql.unsafe(`
        create table public."_niu_migration_journal" (
          module_name text primary key,
          version integer not null,
          contract_version integer not null,
          checksum text not null,
          raw_checksum text not null,
          applied_at timestamptz not null default now()
        )
      `);
    });
    try {
      await assert.rejects(
        () => takeoverMigrations(takeoverOptions),
        /Product migration metadata is incomplete: journal\/profile mismatch/,
      );
      assert.deepEqual(await readMetadataRelations(assertTakeoverTarget), {
        journal: true,
        profile: false,
      });
      assert.deepEqual(
        await readLegacyJournal(TAKEOVER_URL, assertTakeoverTarget),
        legacyJournalBeforeTakeover,
      );
    } finally {
      await mutateTakeoverDatabase(assertTakeoverTarget, async (sql) => {
        await sql`drop table public."_niu_migration_journal"`;
      });
    }
    assert.deepEqual(await readMetadataRelations(assertTakeoverTarget), {
      journal: false,
      profile: false,
    });
  });

  await t.test("恢复后并发接管一实写一跳过，普通 runner 保持两代账本", async (caseTest) => {
    const reports = await Promise.all([
      takeoverMigrations(takeoverOptions),
      takeoverMigrations(takeoverOptions),
    ]);
    const appliedReport = reports.find((report) => report.applied.length > 0);
    const skippedReport = reports.find((report) => report.skipped.length > 0);
    assert.ok(appliedReport, "并发接管必须恰有一次负责首次写入");
    assert.ok(skippedReport, "并发接管必须恰有一次在锁后观察到完整账本");
    assert.deepEqual(
      sortedNames(appliedReport.applied),
      [...EXPECTED_PRODUCT_MODULES],
      "首次接管必须写入排序后固定的五个模块",
    );
    assert.deepEqual(appliedReport.skipped, []);
    assert.deepEqual(sortedNames(skippedReport.skipped), [...EXPECTED_PRODUCT_MODULES]);
    assert.deepEqual(skippedReport.applied, []);

    const productJournalBeforeRepeat = await readProductJournal(assertTakeoverTarget);
    const productProfiles = await readProfiles(assertTakeoverTarget);
    assert.deepEqual(
      productJournalBeforeRepeat.map((row) => row.module_name),
      [...EXPECTED_PRODUCT_MODULES],
      "_niu 账本按模块名排序后必须恰好包含五个产品模块",
    );
    assert.deepEqual(
      productProfiles.map((row) => row.profile_name),
      [PRODUCT_MIGRATION_PLAN.profile.name],
    );
    assert.deepEqual(
      await readLegacyJournal(TAKEOVER_URL, assertTakeoverTarget),
      legacyJournalBeforeTakeover,
      "成功接管必须保留完整旧 _n2 账本",
    );
    assert.deepEqual(
      await readSyntheticTag(assertTakeoverTarget),
      syntheticTagBeforeTakeover,
      "成功接管不得改变合成行或表 OID",
    );

    await caseTest.test("新账本已完成时仍先核验旧账本且失败不改写", async () => {
      const driftedChecksum = "f".repeat(64);
      const [firstLegacyRow] = legacyJournalBeforeTakeover;
      assert.ok(firstLegacyRow, "旧 journal 必须至少包含一行");

      await mutateTakeoverDatabase(assertTakeoverTarget, async (sql) => {
        await sql`
          update public."_n2_migration_journal"
          set checksum = ${driftedChecksum}
          where name = ${firstLegacyRow.name}
        `;
      });
      try {
        await assert.rejects(
          () => takeoverMigrations(takeoverOptions),
          /Legacy migration journal is incomplete or has drifted fingerprints/,
        );
        assert.deepEqual(
          await readProductJournal(assertTakeoverTarget),
          productJournalBeforeRepeat,
          "完整 _niu 账本必须保持只读",
        );
        assert.deepEqual(await readProfiles(assertTakeoverTarget), productProfiles);
      } finally {
        await mutateTakeoverDatabase(assertTakeoverTarget, async (sql) => {
          await sql`
            update public."_n2_migration_journal"
            set checksum = ${firstLegacyRow.checksum}
            where name = ${firstLegacyRow.name}
          `;
        });
      }
      assert.deepEqual(
        await readLegacyJournal(TAKEOVER_URL, assertTakeoverTarget),
        legacyJournalBeforeTakeover,
      );
    });

    const takeoverRepeat = await takeoverMigrations(takeoverOptions);
    const normalRunnerRepeat = await runProductMigrations(takeoverOptions);
    assert.deepEqual(takeoverRepeat.applied, []);
    assert.deepEqual(sortedNames(takeoverRepeat.skipped), [...EXPECTED_PRODUCT_MODULES]);
    assert.deepEqual(normalRunnerRepeat.applied, []);
    assert.deepEqual(sortedNames(normalRunnerRepeat.skipped), [...EXPECTED_PRODUCT_MODULES]);
    assert.deepEqual(
      await readProductJournal(assertTakeoverTarget),
      productJournalBeforeRepeat,
      "重复接管与普通 runner 都不得改写既有 _niu 账本行",
    );
    assert.deepEqual(
      await readLegacyJournal(TAKEOVER_URL, assertTakeoverTarget),
      legacyJournalBeforeTakeover,
      "重复接管与普通 runner 都必须保持旧 _n2 账本",
    );
  });
});
