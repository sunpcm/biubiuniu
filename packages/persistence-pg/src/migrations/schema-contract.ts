import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import postgres from "postgres";
import { quoteIdentifier } from "./identifiers.js";
import {
  acquireMigrationLock,
  assertMigrationGuard,
  assertMigrationJournalNames,
  createMigrationMetadata,
  DEFAULT_MIGRATION_LOCK_KEY,
  migrationSchemaSentinels,
  resolveMigrationPlan,
  writeMigrationJournalEntry,
  writeMigrationProfile,
  type MigrationRunnerOptions,
} from "./runner.js";
import type { MigrationPlan, MigrationReport } from "./types.js";

export const MIGRATION_SCHEMA_CONTRACT_FORMAT_VERSION = 1;

const LEGACY_JOURNAL = "_n2_migration_journal";
const PRODUCT_JOURNAL = "_niu_migration_journal";
const PRODUCT_PROFILE = "_niu_migration_profile";
const MIGRATION_METADATA_TABLES = [LEGACY_JOURNAL, PRODUCT_JOURNAL, PRODUCT_PROFILE] as const;
const PUBLIC_RELATION_KINDS = new Set(["r", "p", "i", "I", "S"]);

export interface MigrationSchemaModule {
  name: string;
  version: number;
  contractVersion: number;
  checksum: string;
  rawChecksum: string;
}

export interface MigrationSchemaContract {
  formatVersion: number;
  postgresMajor: number;
  profile: string;
  modules: MigrationSchemaModule[];
  schemaHash: string;
}

export interface TakeoverMigrationOptions extends MigrationRunnerOptions {
  schemaContract: MigrationSchemaContract;
  legacyJournal: readonly { name: string; checksum: string }[];
}

type SchemaRow = Record<string, unknown>;

interface SchemaSnapshot {
  tables: SchemaRow[];
  columns: SchemaRow[];
  enums: SchemaRow[];
  sequences: SchemaRow[];
  indexes: SchemaRow[];
  constraints: SchemaRow[];
  triggers: SchemaRow[];
  policies: SchemaRow[];
}

interface CapturedSchemaSnapshot {
  postgresMajor: number;
  snapshot: SchemaSnapshot;
}

interface RelationKindRow {
  relation_name: string;
  relation_kind: string;
}

type PublicRelationState =
  | { kind: "missing" }
  | { kind: "table" }
  | { kind: "other"; relationKind: string };

interface ProductJournalRow {
  module_name: string;
  version: number;
  contract_version: number;
  checksum: string;
  raw_checksum: string;
}

interface ForeignKeyTriggerRow {
  table_name: string;
  trigger_name: string;
  enabled: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function publicRelation(identifier: string): string {
  return `${quoteIdentifier("public")}.${quoteIdentifier(identifier)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort(compareText)
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("Schema contract contains a non-JSON value");
  }
  return serialized;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function categoryHashes(snapshot: SchemaSnapshot): Record<string, string> {
  return Object.fromEntries(Object.entries(snapshot).map(([name, rows]) => [name, sha256(rows)]));
}

function contractModules(plan: MigrationPlan): MigrationSchemaModule[] {
  return plan.modules
    .map((module) => ({
      name: module.name,
      version: module.version,
      contractVersion: module.contractVersion,
      checksum: module.checksum,
      rawChecksum: module.rawChecksum,
    }))
    .sort((left, right) => compareText(left.name, right.name));
}

async function configureSchemaRead(tx: postgres.Sql): Promise<void> {
  await tx.unsafe("set local search_path = pg_catalog");
}

function assertProductMetadataNames(options: MigrationRunnerOptions): {
  journal: string;
  profile: string;
} {
  const names = assertMigrationJournalNames(options);
  if (names.journal !== PRODUCT_JOURNAL || names.profile !== PRODUCT_PROFILE) {
    throw new Error(
      "Product migration schema contracts require the fixed public migration journal/profile tables",
    );
  }
  return names;
}

async function assertPublicRelationKinds(sql: postgres.Sql): Promise<void> {
  const excluded = sql.array([...MIGRATION_METADATA_TABLES]);
  const rows = await sql<RelationKindRow[]>`
    select
      relation.relname as relation_name,
      relation.relkind::text as relation_kind
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and not (relation.relname = any(${excluded}))
    order by relation.relname collate "C"
  `;
  const rejected = rows.filter((row) => !PUBLIC_RELATION_KINDS.has(row.relation_kind));
  if (rejected.length > 0) {
    throw new Error(
      "Unsupported public relation in migration schema contract: " +
        rejected.map((row) => `${row.relation_name}(${row.relation_kind})`).join(", "),
    );
  }
}

async function assertForeignKeyTriggerExecution(sql: postgres.Sql): Promise<void> {
  const rows = await sql<ForeignKeyTriggerRow[]>`
    select
      table_class.relname as table_name,
      trigger_record.tgname as trigger_name,
      trigger_record.tgenabled::text as enabled
    from pg_catalog.pg_trigger as trigger_record
    join pg_catalog.pg_class as table_class
      on table_class.oid = trigger_record.tgrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = table_class.relnamespace
    join pg_catalog.pg_constraint as constraint_record
      on constraint_record.oid = trigger_record.tgconstraint
    where namespace.nspname = 'public'
      and table_class.relkind in ('r', 'p')
      and trigger_record.tgisinternal
      and constraint_record.contype = 'f'
    order by
      table_class.relname collate "C",
      trigger_record.tgname collate "C"
  `;
  const rejected = rows.filter(({ enabled }) => enabled !== "O" && enabled !== "A");
  if (rejected.length > 0) {
    throw new Error(
      "Foreign key trigger execution is not enabled for origin: " +
        rejected
          .map(
            ({ table_name, trigger_name, enabled }) => `${table_name}.${trigger_name}(${enabled})`,
          )
          .join(", "),
    );
  }
}

async function captureSchemaSnapshot(sql: postgres.Sql): Promise<CapturedSchemaSnapshot> {
  const [server] = await sql<{ postgres_major: number }[]>`
    select (pg_catalog.current_setting('server_version_num')::integer / 10000)::integer
      as postgres_major
  `;
  if (!server) {
    throw new Error("Schema contract capture: PostgreSQL version query returned no row");
  }

  const excluded = sql.array([...MIGRATION_METADATA_TABLES]);
  const tables = await sql<SchemaRow[]>`
    select
      table_class.relname as table_name,
      table_class.relkind::text as relkind,
      table_class.relpersistence::text as relpersistence,
      table_class.relrowsecurity as row_security,
      table_class.relforcerowsecurity as force_row_security
    from pg_catalog.pg_class as table_class
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = table_class.relnamespace
    where namespace.nspname = 'public'
      and table_class.relkind in ('r', 'p')
      and not (table_class.relname = any(${excluded}))
    order by table_class.relname collate "C"
  `;

  const columns = await sql<SchemaRow[]>`
    select
      table_class.relname as table_name,
      attribute.attname as column_name,
      attribute.attnum::integer as ordinal,
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) as data_type,
      attribute.attnotnull as not_null,
      pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid, true)
        as default_expression,
      attribute.attidentity::text as identity,
      attribute.attgenerated::text as generated,
      case
        when attribute.attcollation = 0 then null
        else
          pg_catalog.quote_ident(collation_namespace.nspname) || '.' ||
          pg_catalog.quote_ident(column_collation.collname)
      end as collation
    from pg_catalog.pg_class as table_class
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = table_class.relnamespace
    join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = table_class.oid
    left join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = table_class.oid
     and default_value.adnum = attribute.attnum
    left join pg_catalog.pg_collation as column_collation
      on column_collation.oid = attribute.attcollation
    left join pg_catalog.pg_namespace as collation_namespace
      on collation_namespace.oid = column_collation.collnamespace
    where namespace.nspname = 'public'
      and table_class.relkind in ('r', 'p')
      and not (table_class.relname = any(${excluded}))
      and attribute.attnum > 0
      and not attribute.attisdropped
    order by
      table_class.relname collate "C",
      attribute.attnum
  `;

  const enums = await sql<SchemaRow[]>`
    select
      enum_type.typname as type_name,
      pg_catalog.array_agg(enum_value.enumlabel order by enum_value.enumsortorder)
        as labels
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

  const sequences = await sql<SchemaRow[]>`
    select
      sequence_class.relname as sequence_name,
      pg_catalog.format_type(sequence_config.seqtypid, null) as data_type,
      sequence_config.seqstart::text as start_value,
      sequence_config.seqmin::text as minimum_value,
      sequence_config.seqmax::text as maximum_value,
      sequence_config.seqincrement::text as increment_by,
      sequence_config.seqcycle as cycle,
      sequence_config.seqcache::text as cache_size,
      owner_namespace.nspname as owner_schema,
      owner_table.relname as owner_table,
      owner_column.attname as owner_column
    from pg_catalog.pg_class as sequence_class
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = sequence_class.relnamespace
    join pg_catalog.pg_sequence as sequence_config
      on sequence_config.seqrelid = sequence_class.oid
    left join pg_catalog.pg_depend as dependency
      on dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
     and dependency.objid = sequence_class.oid
     and dependency.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
     and dependency.deptype in ('a', 'i')
    left join pg_catalog.pg_class as owner_table
      on owner_table.oid = dependency.refobjid
    left join pg_catalog.pg_namespace as owner_namespace
      on owner_namespace.oid = owner_table.relnamespace
    left join pg_catalog.pg_attribute as owner_column
      on owner_column.attrelid = dependency.refobjid
     and owner_column.attnum = dependency.refobjsubid
    where namespace.nspname = 'public'
      and sequence_class.relkind = 'S'
      and not (sequence_class.relname = any(${excluded}))
    order by sequence_class.relname collate "C"
  `;

  const indexes = await sql<SchemaRow[]>`
    select
      table_class.relname as table_name,
      index_class.relname as index_name,
      index_record.indisunique as is_unique,
      index_record.indisprimary as is_primary,
      index_record.indisvalid as is_valid,
      index_record.indisready as is_ready,
      pg_catalog.pg_get_indexdef(index_record.indexrelid, 0, true) as definition
    from pg_catalog.pg_index as index_record
    join pg_catalog.pg_class as table_class
      on table_class.oid = index_record.indrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = table_class.relnamespace
    join pg_catalog.pg_class as index_class
      on index_class.oid = index_record.indexrelid
    where namespace.nspname = 'public'
      and table_class.relkind in ('r', 'p')
      and not (table_class.relname = any(${excluded}))
    order by
      table_class.relname collate "C",
      index_class.relname collate "C"
  `;

  const constraints = await sql<SchemaRow[]>`
    select
      table_class.relname as table_name,
      constraint_record.conname as constraint_name,
      constraint_record.contype::text as constraint_type,
      constraint_record.convalidated as is_validated,
      constraint_record.condeferrable as is_deferrable,
      constraint_record.condeferred as is_deferred,
      pg_catalog.pg_get_constraintdef(constraint_record.oid, true) as definition
    from pg_catalog.pg_constraint as constraint_record
    join pg_catalog.pg_class as table_class
      on table_class.oid = constraint_record.conrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = table_class.relnamespace
    where namespace.nspname = 'public'
      and table_class.relkind in ('r', 'p')
      and not (table_class.relname = any(${excluded}))
    order by
      table_class.relname collate "C",
      constraint_record.conname collate "C"
  `;

  const triggers = await sql<SchemaRow[]>`
    select
      table_class.relname as table_name,
      trigger_record.tgname as trigger_name,
      pg_catalog.pg_get_triggerdef(trigger_record.oid, true) as definition,
      trigger_record.tgenabled::text as enabled,
      trigger_record.tgtype::integer as trigger_type,
      trigger_record.tgdeferrable as is_deferrable,
      trigger_record.tginitdeferred as is_deferred
    from pg_catalog.pg_trigger as trigger_record
    join pg_catalog.pg_class as table_class
      on table_class.oid = trigger_record.tgrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = table_class.relnamespace
    where namespace.nspname = 'public'
      and table_class.relkind in ('r', 'p')
      and not (table_class.relname = any(${excluded}))
      and not trigger_record.tgisinternal
    order by
      table_class.relname collate "C",
      trigger_record.tgname collate "C"
  `;

  const policies = await sql<SchemaRow[]>`
    select
      table_class.relname as table_name,
      policy_record.polname as policy_name,
      policy_record.polcmd::text as command,
      policy_record.polpermissive as is_permissive,
      coalesce(
        (
          select pg_catalog.array_agg(
            case
              when role_oid = 0 then 'PUBLIC'
              else policy_role.rolname::text
            end
            order by
              case
                when role_oid = 0 then 'PUBLIC'
                else policy_role.rolname::text
              end collate "C"
          )
          from pg_catalog.unnest(policy_record.polroles) as role_oid
          left join pg_catalog.pg_roles as policy_role
            on policy_role.oid = role_oid
        ),
        array[]::text[]
      ) as roles,
      pg_catalog.pg_get_expr(
        policy_record.polqual,
        policy_record.polrelid,
        true
      ) as using_expression,
      pg_catalog.pg_get_expr(
        policy_record.polwithcheck,
        policy_record.polrelid,
        true
      ) as check_expression
    from pg_catalog.pg_policy as policy_record
    join pg_catalog.pg_class as table_class
      on table_class.oid = policy_record.polrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = table_class.relnamespace
    where namespace.nspname = 'public'
      and table_class.relkind in ('r', 'p')
      and not (table_class.relname = any(${excluded}))
    order by
      table_class.relname collate "C",
      policy_record.polname collate "C"
  `;

  return {
    postgresMajor: server.postgres_major,
    snapshot: {
      tables,
      columns,
      enums,
      sequences,
      indexes,
      constraints,
      triggers,
      policies,
    },
  };
}

function assertSchemaContract(
  expected: MigrationSchemaContract,
  plan: MigrationPlan,
  captured: CapturedSchemaSnapshot,
): void {
  if (expected.formatVersion !== MIGRATION_SCHEMA_CONTRACT_FORMAT_VERSION) {
    throw new Error(
      `Unsupported migration schema contract format ${expected.formatVersion}; ` +
        `expected ${MIGRATION_SCHEMA_CONTRACT_FORMAT_VERSION}`,
    );
  }
  if (!/^[a-f0-9]{64}$/.test(expected.schemaHash)) {
    throw new Error("Migration schema contract has an invalid schema hash");
  }
  if (expected.postgresMajor !== captured.postgresMajor) {
    throw new Error("Product migration schema contract mismatch: postgresMajor");
  }
  if (expected.profile !== plan.profile) {
    throw new Error("Product migration schema contract mismatch: profile");
  }
  if (!isDeepStrictEqual(expected.modules, contractModules(plan))) {
    throw new Error("Product migration schema contract mismatch: modules");
  }
  if (expected.schemaHash !== sha256(captured.snapshot)) {
    const diagnostics = Object.entries(categoryHashes(captured.snapshot))
      .map(([name, hash]) => `${name}=${hash}`)
      .join(",");
    throw new Error(
      `Product migration schema contract mismatch: schemaHash (actual categories ${diagnostics})`,
    );
  }
}

export async function captureMigrationSchemaContract(
  options: MigrationRunnerOptions,
): Promise<MigrationSchemaContract> {
  const plan = resolveMigrationPlan(options);
  assertProductMetadataNames(options);
  const sql = postgres(options.url, { max: 1 });
  let captured: CapturedSchemaSnapshot | undefined;
  try {
    await sql.begin(async (rawTx) => {
      const tx = rawTx as unknown as postgres.Sql;
      await tx.unsafe("set transaction isolation level repeatable read");
      await tx.unsafe("set transaction read only");
      await configureSchemaRead(tx);
      await assertMigrationGuard(tx, options.guard);
      await assertPublicRelationKinds(tx);
      captured = await captureSchemaSnapshot(tx);
    });
  } finally {
    await sql.end();
  }

  if (!captured) {
    throw new Error("Schema contract capture did not produce a snapshot");
  }
  return {
    formatVersion: MIGRATION_SCHEMA_CONTRACT_FORMAT_VERSION,
    postgresMajor: captured.postgresMajor,
    profile: plan.profile,
    modules: contractModules(plan),
    schemaHash: sha256(captured.snapshot),
  };
}

async function publicRelationState(
  sql: postgres.Sql,
  identifier: string,
): Promise<PublicRelationState> {
  const [row] = await sql<{ relation_kind: string }[]>`
    select relation.relkind::text as relation_kind
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = ${identifier}
  `;
  if (!row) return { kind: "missing" };
  if (row.relation_kind === "r" || row.relation_kind === "p") return { kind: "table" };
  return { kind: "other", relationKind: row.relation_kind };
}

async function assertLegacyJournal(
  tx: postgres.Sql,
  expectedJournal: TakeoverMigrationOptions["legacyJournal"],
): Promise<void> {
  const expected = expectedJournal
    .map(({ name, checksum }) => ({ name, checksum }))
    .sort((left, right) => compareText(left.name, right.name));
  if (new Set(expected.map((row) => row.name)).size !== expected.length) {
    throw new Error("Legacy migration journal expectation contains duplicate module names");
  }
  if (expected.length === 0) {
    throw new Error("Legacy migration journal expectation is empty");
  }
  const state = await publicRelationState(tx, LEGACY_JOURNAL);
  if (state.kind === "missing") {
    throw new Error("Legacy migration journal is missing");
  }
  if (state.kind === "other") {
    throw new Error(
      `Legacy migration journal must be an ordinary or partitioned table, found (${state.relationKind})`,
    );
  }

  const actualResult = await tx<{ name: string; checksum: string }[]>`
    select name, checksum
    from ${tx.unsafe(publicRelation(LEGACY_JOURNAL))}
    order by name collate "C"
  `;
  const actual = Array.from(actualResult, (row) => ({
    name: row.name,
    checksum: row.checksum,
  }));
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error("Legacy migration journal is incomplete or has drifted fingerprints");
  }
}

function expectedProductJournal(plan: MigrationPlan): ProductJournalRow[] {
  return plan.modules
    .map((module) => ({
      module_name: module.name,
      version: module.version,
      contract_version: module.contractVersion,
      checksum: module.checksum,
      raw_checksum: module.rawChecksum,
    }))
    .sort((left, right) => compareText(left.module_name, right.module_name));
}

async function inspectProductMetadata(
  tx: postgres.Sql,
  names: { journal: string; profile: string },
  plan: MigrationPlan,
): Promise<"missing" | "complete"> {
  const journalState = await publicRelationState(tx, names.journal);
  const profileState = await publicRelationState(tx, names.profile);
  for (const [name, state] of [
    [names.journal, journalState],
    [names.profile, profileState],
  ] as const) {
    if (state.kind === "other") {
      throw new Error(
        `Product migration metadata ${name} must be an ordinary or partitioned table, found (${state.relationKind})`,
      );
    }
  }
  const journalExists = journalState.kind === "table";
  const profileExists = profileState.kind === "table";
  if (journalExists !== profileExists) {
    throw new Error("Product migration metadata is incomplete: journal/profile mismatch");
  }
  if (!journalExists) return "missing";

  const journalResult = await tx<ProductJournalRow[]>`
    select module_name, version, contract_version, checksum, raw_checksum
    from ${tx.unsafe(publicRelation(names.journal))}
    order by module_name collate "C"
  `;
  const journal = Array.from(journalResult, (row) => ({
    module_name: row.module_name,
    version: row.version,
    contract_version: row.contract_version,
    checksum: row.checksum,
    raw_checksum: row.raw_checksum,
  }));
  if (!isDeepStrictEqual(journal, expectedProductJournal(plan))) {
    throw new Error("Product migration journal is incomplete or has drifted fingerprints");
  }

  const profilesResult = await tx<{ profile_name: string }[]>`
    select profile_name
    from ${tx.unsafe(publicRelation(names.profile))}
    order by profile_name collate "C"
  `;
  const profiles = Array.from(profilesResult, (row) => ({
    profile_name: row.profile_name,
  }));
  if (!isDeepStrictEqual(profiles, [{ profile_name: plan.profile }])) {
    throw new Error("Product migration profile journal is incomplete or incompatible");
  }
  return "complete";
}

function takeoverVerified(plan: MigrationPlan): string[] {
  const sentinels = migrationSchemaSentinels(plan.modules);
  return [...sentinels.tables, ...sentinels.columns];
}

export async function takeoverMigrations(
  options: TakeoverMigrationOptions,
): Promise<MigrationReport> {
  const plan = resolveMigrationPlan(options);
  const names = assertProductMetadataNames(options);
  const lockKey = options.lockKey ?? DEFAULT_MIGRATION_LOCK_KEY;
  const sql = postgres(options.url, { max: 1 });
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
      await assertMigrationGuard(tx, options.guard);
      await configureSchemaRead(tx);

      await assertLegacyJournal(tx, options.legacyJournal);
      await assertPublicRelationKinds(tx);
      await assertForeignKeyTriggerExecution(tx);
      const captured = await captureSchemaSnapshot(tx);
      assertSchemaContract(options.schemaContract, plan, captured);

      const metadataState = await inspectProductMetadata(tx, names, plan);
      if (metadataState === "missing") {
        await createMigrationMetadata(tx, names);
        for (const module of plan.modules) {
          await writeMigrationJournalEntry(tx, names.journal, module);
          report.applied.push(module.name);
        }
        await writeMigrationProfile(tx, names.profile, plan.profile);
      } else {
        report.skipped.push(...plan.modules.map((module) => module.name));
      }
      report.verified.push(...takeoverVerified(plan));
    });
  } finally {
    await sql.end();
  }

  return report;
}
