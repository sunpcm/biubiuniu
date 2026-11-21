import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MigrationFile, MigrationSource } from "./migration-types";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** Real migration directory next to this module, independent of `cwd`. */
export const DEFAULT_MIGRATIONS_DIR = join(MODULE_DIR, "migrations");

/** Drizzle statement separator. */
export const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/**
 * Historical checksum payload: split at drizzle breakpoints, trim each chunk,
 * drop empty chunks, then join with `;\n`. This matches the existing
 * `_n2_migration_journal` compatibility checksum byte-for-byte.
 */
export function migrationStatements(raw: string): string {
  return raw
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter(Boolean)
    .join(";\n");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function toMigrationFile(name: string, raw: string): MigrationFile {
  const statements = migrationStatements(raw);
  return {
    name,
    raw,
    statements,
    checksum: sha256Hex(statements),
    rawChecksum: sha256Hex(raw),
  };
}

interface DrizzleJournalMeta {
  version?: string;
  dialect?: string;
  entries?: Array<{ tag?: string }>;
}

/**
 * Strictly resolves the frozen migration chain from `meta/_journal.json`.
 *
 * There is deliberately no fallback to "whatever `*.sql` files remain in the
 * directory": a missing/bad meta, an empty entry list, a duplicate identity, an
 * abnormal tag path, or any declared SQL that is absent is a hard error. This
 * keeps a corrupted resource from silently disappearing out of the validation
 * set while a reference database with existing journal rows still appears to
 * pass.
 */
export function migrationFileNames(dir: string = DEFAULT_MIGRATIONS_DIR): string[] {
  const metaPath = join(dir, "meta", "_journal.json");
  let meta: DrizzleJournalMeta;
  try {
    meta = JSON.parse(readFileSync(metaPath, "utf8")) as DrizzleJournalMeta;
  } catch (error) {
    throw new Error(
      `Migration meta is missing or unreadable (${metaPath}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const entries = meta.entries ?? [];
  if (entries.length === 0) {
    throw new Error(`Migration meta declares no entries (${metaPath})`);
  }

  const names = entries.map((entry) => {
    const tag = entry.tag;
    if (typeof tag !== "string" || tag.length === 0) {
      throw new Error(`Migration meta entry has an invalid tag: ${JSON.stringify(entry)}`);
    }
    const name = `${tag}.sql`;
    if (name !== basename(name)) {
      throw new Error(`Migration tag resolves to an abnormal file name: ${tag}`);
    }
    return name;
  });

  if (new Set(names).size !== names.length) {
    throw new Error(`Migration meta declares duplicate identities: ${names.join(", ")}`);
  }

  for (const name of names) {
    if (!existsSync(join(dir, name))) {
      throw new Error(`Declared migration SQL is missing: ${name}`);
    }
  }

  return names;
}

export function createFileSystemSource(
  dir: string = DEFAULT_MIGRATIONS_DIR,
): MigrationSource {
  const files = migrationFileNames(dir);
  return {
    list: () => [...files],
    read: (name) => readFileSync(join(dir, name), "utf8"),
  };
}

export const defaultMigrationSource = createFileSystemSource();
