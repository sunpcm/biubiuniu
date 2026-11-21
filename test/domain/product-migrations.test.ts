import assert from "node:assert/strict";
import { test } from "node:test";
import postgres from "postgres";
import { runMigrations } from "@sunpcm/niu-persistence-pg/migrations";
import { PRODUCT_MIGRATION_PLAN } from "@/lib/db/product-migrations";
import { assertIsolatedTarget, assertPostgresUrl, databaseUrl, EXPECTED_ROLE } from "./helpers";

const PRODUCT_DATABASE = "nexty_overnight_20261105_n3_product";
const PRODUCT_PROFILE = "nano_payments_cms";
const EXPECTED_JOURNAL_MODULES = ["auth", "credits", "nano", "payments", "cms_feedback"] as const;

const PRODUCT_TABLES = ["feedback", "feedback_replies", "post_tags", "posts", "tags"] as const;

const EXPECTED_COLUMNS = {
  feedback: [
    "id",
    "user_id",
    "submitter_email",
    "submitter_name",
    "type",
    "title",
    "description",
    "priority",
    "status",
    "created_at",
    "updated_at",
  ],
  feedback_replies: [
    "id",
    "feedback_id",
    "author_id",
    "author_email",
    "author_name",
    "is_admin",
    "content",
    "created_at",
  ],
  post_tags: ["post_id", "tag_id"],
  posts: [
    "id",
    "language",
    "post_type",
    "author_id",
    "title",
    "slug",
    "content",
    "description",
    "featured_image_url",
    "is_pinned",
    "status",
    "visibility",
    "published_at",
    "created_at",
    "updated_at",
  ],
  tags: ["id", "name", "post_type", "created_at"],
} as const;

const EXPECTED_ENUMS = {
  feedback_priority: ["low", "medium", "high"],
  feedback_status: ["submitted", "under_review", "planned", "in_progress", "completed", "declined"],
  feedback_type: ["feature_request", "bug_report", "improvement", "other"],
  post_status: ["draft", "published", "archived"],
  post_type: ["blog", "glossary"],
  post_visibility: ["public", "logged_in", "subscribers"],
} as const;

const EXPECTED_CONSTRAINTS = [
  "feedback_pkey",
  "feedback_replies_author_id_user_id_fk",
  "feedback_replies_feedback_id_feedback_id_fk",
  "feedback_replies_pkey",
  "feedback_user_id_user_id_fk",
  "post_tags_post_id_posts_id_fk",
  "post_tags_post_id_tag_id_pk",
  "post_tags_tag_id_tags_id_fk",
  "posts_author_id_user_id_fk",
  "posts_language_slug_post_type_unique",
  "posts_pkey",
  "tags_name_post_type_unique",
  "tags_pkey",
] as const;

const EXPECTED_INDEXES = [
  "feedback_pkey",
  "feedback_replies_pkey",
  "idx_feedback_created_at",
  "idx_feedback_replies_feedback_created_at",
  "idx_feedback_status",
  "idx_feedback_type",
  "idx_feedback_user_created_at",
  "idx_post_tags_post_id",
  "idx_post_tags_tag_id",
  "idx_posts_author_id",
  "idx_posts_language_post_type_status",
  "idx_posts_language_status",
  "idx_posts_post_type",
  "idx_posts_status",
  "idx_posts_visibility",
  "idx_tags_name",
  "post_tags_post_id_tag_id_pk",
  "posts_language_slug_post_type_unique",
  "posts_pkey",
  "tags_name_post_type_unique",
  "tags_pkey",
] as const;

type IdentityGuard = (database: string, role: string) => void;
type SqlClient = ReturnType<typeof postgres>;

interface ColumnRow {
  table_name: string;
  ordinal: number;
  column_name: string;
  data_type: string;
  not_null: boolean;
  default_expression: string | null;
}

interface ConstraintRow {
  table_name: string;
  constraint_name: string;
  constraint_type: string;
  referenced_table: string | null;
  definition: string;
}

interface IndexRow {
  table_name: string;
  index_name: string;
  is_unique: boolean;
  is_primary: boolean;
  access_method: string;
  definition: string;
}

interface ProductSnapshot {
  tables: string[];
  enums: Record<string, string[]>;
  columns: ColumnRow[];
  constraints: ConstraintRow[];
  indexes: IndexRow[];
}

interface JournalRow {
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

interface LedgerSnapshot {
  journal: JournalRow[];
  profiles: ProfileRow[];
}

function deriveProductDatabaseUrl(): string {
  const productUrl = new URL(databaseUrl());
  productUrl.pathname = `/${PRODUCT_DATABASE}`;
  return assertPostgresUrl(productUrl.toString(), PRODUCT_DATABASE);
}

const LEGACY_URL = databaseUrl();
const PRODUCT_URL = deriveProductDatabaseUrl();

function assertProductTarget(database: string, role: string): void {
  if (database !== PRODUCT_DATABASE) {
    throw new Error(`拒绝在意外数据库 "${database}" 上执行产品迁移；预期 "${PRODUCT_DATABASE}"`);
  }
  if (role !== EXPECTED_ROLE) {
    throw new Error(`拒绝以意外角色 "${role}" 执行产品迁移；预期 "${EXPECTED_ROLE}"`);
  }
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

async function readProductSnapshot(url: string, guard: IdentityGuard): Promise<ProductSnapshot> {
  const sql = postgres(url, { max: 1 });
  try {
    await assertConnectionIdentity(sql, guard);

    const tableRows = await sql<{ table_name: string }[]>`
      select class.relname as table_name
      from pg_class as class
      join pg_namespace as namespace
        on namespace.oid = class.relnamespace
      where namespace.nspname = 'public'
        and class.relkind in ('r', 'p')
        and class.relname = any(${sql.array([...PRODUCT_TABLES])})
      order by class.relname
    `;

    const enumRows = await sql<{ type_name: string; ordinal: number; label: string }[]>`
      select
        enum_type.typname as type_name,
        enum_value.enumsortorder::int as ordinal,
        enum_value.enumlabel as label
      from pg_type as enum_type
      join pg_namespace as namespace
        on namespace.oid = enum_type.typnamespace
      join pg_enum as enum_value
        on enum_value.enumtypid = enum_type.oid
      where namespace.nspname = 'public'
        and enum_type.typname = any(${sql.array(Object.keys(EXPECTED_ENUMS))})
      order by enum_type.typname, enum_value.enumsortorder
    `;

    const columnRows = await sql<ColumnRow[]>`
      select
        table_class.relname as table_name,
        attribute.attnum::int as ordinal,
        attribute.attname as column_name,
        format_type(attribute.atttypid, attribute.atttypmod) as data_type,
        attribute.attnotnull as not_null,
        pg_get_expr(default_value.adbin, default_value.adrelid) as default_expression
      from pg_class as table_class
      join pg_namespace as namespace
        on namespace.oid = table_class.relnamespace
      join pg_attribute as attribute
        on attribute.attrelid = table_class.oid
      left join pg_attrdef as default_value
        on default_value.adrelid = table_class.oid
       and default_value.adnum = attribute.attnum
      where namespace.nspname = 'public'
        and table_class.relkind in ('r', 'p')
        and table_class.relname = any(${sql.array([...PRODUCT_TABLES])})
        and attribute.attnum > 0
        and not attribute.attisdropped
      order by table_class.relname, attribute.attnum
    `;

    const constraintRows = await sql<ConstraintRow[]>`
      select
        table_class.relname as table_name,
        constraint_record.conname as constraint_name,
        constraint_record.contype::text as constraint_type,
        referenced_class.relname as referenced_table,
        pg_get_constraintdef(constraint_record.oid, true) as definition
      from pg_constraint as constraint_record
      join pg_class as table_class
        on table_class.oid = constraint_record.conrelid
      join pg_namespace as namespace
        on namespace.oid = table_class.relnamespace
      left join pg_class as referenced_class
        on referenced_class.oid = constraint_record.confrelid
      where namespace.nspname = 'public'
        and table_class.relname = any(${sql.array([...PRODUCT_TABLES])})
      order by table_class.relname, constraint_record.conname
    `;

    const indexRows = await sql<IndexRow[]>`
      select
        table_class.relname as table_name,
        index_class.relname as index_name,
        index_record.indisunique as is_unique,
        index_record.indisprimary as is_primary,
        access_method.amname as access_method,
        pg_get_indexdef(index_record.indexrelid, 0, true) as definition
      from pg_index as index_record
      join pg_class as table_class
        on table_class.oid = index_record.indrelid
      join pg_namespace as namespace
        on namespace.oid = table_class.relnamespace
      join pg_class as index_class
        on index_class.oid = index_record.indexrelid
      join pg_am as access_method
        on access_method.oid = index_class.relam
      where namespace.nspname = 'public'
        and table_class.relname = any(${sql.array([...PRODUCT_TABLES])})
      order by table_class.relname, index_class.relname
    `;

    const enums = Object.fromEntries(
      Object.keys(EXPECTED_ENUMS).map((typeName) => [
        typeName,
        enumRows
          .filter((row) => row.type_name === typeName)
          .sort((left, right) => left.ordinal - right.ordinal)
          .map((row) => row.label),
      ]),
    );

    return {
      tables: tableRows.map((row) => row.table_name),
      enums,
      columns: columnRows,
      constraints: constraintRows,
      indexes: indexRows,
    };
  } finally {
    await sql.end();
  }
}

function assertExpectedObjects(snapshot: ProductSnapshot, label: string): void {
  assert.deepEqual(
    [...snapshot.tables].sort(),
    [...PRODUCT_TABLES].sort(),
    `${label} 必须实际存在全部 5 个产品表`,
  );
  assert.deepEqual(
    Object.fromEntries(
      PRODUCT_TABLES.map((tableName) => [
        tableName,
        snapshot.columns
          .filter((row) => row.table_name === tableName)
          .sort((left, right) => left.ordinal - right.ordinal)
          .map((row) => row.column_name),
      ]),
    ),
    EXPECTED_COLUMNS,
    `${label} 的产品表列名或列顺序不一致`,
  );
  assert.deepEqual(snapshot.enums, EXPECTED_ENUMS, `${label} 的 6 个枚举名称与顺序不一致`);
  assert.deepEqual(
    [...new Set(snapshot.constraints.map((row) => row.constraint_name))].sort(),
    [...EXPECTED_CONSTRAINTS].sort(),
    `${label} 缺少或多出产品约束`,
  );
  assert.deepEqual(
    [...new Set(snapshot.indexes.map((row) => row.index_name))].sort(),
    [...EXPECTED_INDEXES].sort(),
    `${label} 缺少或多出产品索引`,
  );
}

async function readLedger(url: string, guard: IdentityGuard): Promise<LedgerSnapshot> {
  const sql = postgres(url, { max: 1 });
  try {
    await assertConnectionIdentity(sql, guard);
    const journal = await sql<JournalRow[]>`
      select
        module_name,
        version::int as version,
        contract_version::int as contract_version,
        checksum,
        raw_checksum,
        applied_at
      from "_niu_migration_journal"
      order by module_name
    `;
    const profiles = await sql<ProfileRow[]>`
      select profile_name, applied_at
      from "_niu_migration_profile"
      order by profile_name
    `;
    return { journal, profiles };
  } finally {
    await sql.end();
  }
}

function runProductMigrations() {
  return runMigrations({
    url: PRODUCT_URL,
    profile: PRODUCT_MIGRATION_PLAN.profile.name,
    modules: PRODUCT_MIGRATION_PLAN.modules,
    roots: PRODUCT_MIGRATION_PLAN.roots,
    guard: assertProductTarget,
  });
}

test("nano_payments_cms 新空库产物与旧 _n2 产品物理契约完全一致", async () => {
  const report = await runProductMigrations();
  assert.equal(report.profile, PRODUCT_PROFILE);

  const [legacySnapshot, productSnapshot, ledger] = await Promise.all([
    readProductSnapshot(LEGACY_URL, assertIsolatedTarget),
    readProductSnapshot(PRODUCT_URL, assertProductTarget),
    readLedger(PRODUCT_URL, assertProductTarget),
  ]);

  assertExpectedObjects(legacySnapshot, "旧 _n2 基准库");
  assertExpectedObjects(productSnapshot, "nano_payments_cms 新空库");
  assert.deepEqual(
    productSnapshot,
    legacySnapshot,
    "新空库的列、类型、空值、默认值、枚举顺序、约束和索引必须与完整旧链一致",
  );
  assert.deepEqual(
    ledger.profiles.map((row) => row.profile_name),
    [PRODUCT_PROFILE],
    "迁移账本必须记录 nano_payments_cms profile",
  );
  assert.deepEqual(
    ledger.journal.map((row) => row.module_name).sort(),
    [...EXPECTED_JOURNAL_MODULES].sort(),
    "首个空库迁移必须恰好记录 auth、credits、nano、payments 与 cms_feedback 五个模块",
  );
});

test("nano_payments_cms 重跑不追加账本行且沿用相同指纹", async () => {
  const initialRun = await runProductMigrations();
  const plannedModules = initialRun.modules.map((module) => module.name);
  const beforeRerun = await readLedger(PRODUCT_URL, assertProductTarget);

  const rerun = await runProductMigrations();

  assert.deepEqual(rerun.applied, [], "重跑不得再次应用任何模块");
  assert.deepEqual(rerun.skipped, plannedModules, "重跑必须逐模块复用既有账本");
  assert.deepEqual(
    await readLedger(PRODUCT_URL, assertProductTarget),
    beforeRerun,
    "重跑不得改写 journal/profile 行或其校验指纹",
  );
});
