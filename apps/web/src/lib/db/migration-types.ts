import type postgres from "postgres";

/**
 * One migration's content and the two checksums derived from it.
 *
 * `checksum` is the authoritative identity in `_n2_migration_journal`: the
 * SHA-256 of the drizzle statement stream (split on `--> statement-breakpoint`,
 * each chunk trimmed, empty chunks dropped, then joined with `;\n`). It is not
 * the raw file hash, so a reflow/whitespace-only edit that yields identical
 * statements keeps the same identity.
 */
export interface MigrationFile {
  /** File name including `.sql` — the stable journal identity. */
  name: string;
  /** Exact UTF-8 bytes read from disk. */
  raw: string;
  /** DDL actually executed: breakpoints removed and joined with `;\n`. */
  statements: string;
  /** SHA-256 of `statements`; the historical compatibility checksum. */
  checksum: string;
  /** SHA-256 of `raw`; supplementary integrity, not the identity. */
  rawChecksum: string;
}

export interface MigrationSource {
  /** Ordered migration identities. */
  list(): string[];
  /** Raw file content for a given identity. */
  read(name: string): string;
}

export interface MigrationReport {
  applied: string[];
  skipped: string[];
  verified: string[];
  /** Every processed file, in order, with both checksums. */
  files: MigrationFile[];
}

export type IsolationGuard = (database: string, role: string) => void;

/** Persists one journal row inside the already-open transaction. */
export type JournalWrite = (
  tx: postgres.Sql,
  journal: string,
  file: MigrationFile,
) => Promise<void>;

export interface MigrationRunnerOptions {
  url: string;
  schema?: string;
  lockKey?: string;
  source?: MigrationSource;
  guard?: IsolationGuard;
  verifySchema?: boolean;
  journalTable?: string;
  journalWrite?: JournalWrite;
}
