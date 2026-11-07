import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  DEFAULT_MIGRATIONS_DIR,
  createFileSystemSource,
  defaultMigrationSource,
  migrationFileNames,
  toMigrationFile,
} from "@/lib/db/migration-source";

/**
 * These tests copy the real migration directory into an owned scratch dir and
 * mutate the copy. They never touch the real historical SQL/meta, and they do
 * not need PostgreSQL.
 */
function copyResources(): string {
  const scratch = mkdtempSync(join(tmpdir(), "migration-source-"));
  cpSync(DEFAULT_MIGRATIONS_DIR, scratch, { recursive: true });
  return scratch;
}

test("canonical source reads the frozen meta-ordered resources", () => {
  const expected = defaultMigrationSource.list();
  assert.deepEqual(migrationFileNames(DEFAULT_MIGRATIONS_DIR), expected);

  const scratch = copyResources();
  try {
    const source = createFileSystemSource(scratch);
    assert.deepEqual(source.list(), expected);
    for (const name of expected) {
      const original = toMigrationFile(name, defaultMigrationSource.read(name));
      const copied = toMigrationFile(name, source.read(name));
      assert.equal(copied.checksum, original.checksum);
      assert.equal(copied.rawChecksum, original.rawChecksum);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("missing declared SQL fails fast instead of dropping from the list", () => {
  const scratch = copyResources();
  try {
    const first = migrationFileNames(scratch)[0];
    unlinkSync(join(scratch, first));
    assert.throws(() => createFileSystemSource(scratch), /missing/i);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("corrupted meta fails fast", () => {
  const scratch = copyResources();
  try {
    writeFileSync(join(scratch, "meta", "_journal.json"), "{ not valid json", "utf8");
    assert.throws(() => createFileSystemSource(scratch), /meta is missing or unreadable/i);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("empty meta entries fail fast", () => {
  const scratch = copyResources();
  try {
    writeFileSync(
      join(scratch, "meta", "_journal.json"),
      JSON.stringify({ entries: [] }),
      "utf8",
    );
    assert.throws(() => createFileSystemSource(scratch), /no entries/i);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("duplicate identity fails fast", () => {
  const scratch = copyResources();
  try {
    writeFileSync(
      join(scratch, "meta", "_journal.json"),
      JSON.stringify({ entries: [{ tag: "dup" }, { tag: "dup" }] }),
      "utf8",
    );
    assert.throws(() => createFileSystemSource(scratch), /duplicate/i);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("abnormal tag path fails fast", () => {
  const scratch = copyResources();
  try {
    writeFileSync(
      join(scratch, "meta", "_journal.json"),
      JSON.stringify({ entries: [{ tag: "../escape" }] }),
      "utf8",
    );
    assert.throws(() => createFileSystemSource(scratch), /abnormal/i);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
