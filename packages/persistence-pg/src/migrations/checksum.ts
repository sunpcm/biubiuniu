import { createHash } from "node:crypto";
import type { MigrationModule, ResolvedModule } from "./types.js";

/** Drizzle statement separator, shared with the legacy reference runner. */
export const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/**
 * Normalize a raw SQL module into its executable statement stream.
 *
 * Matches the historical checksum payload: split on breakpoints, trim each
 * chunk, drop empty chunks, join with `;\n`.
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

/** Resolve an immutable module into its executable form plus both checksums. */
export function resolveModule(module: MigrationModule): ResolvedModule {
  const statements = migrationStatements(module.sql);
  if (statements.trim() === "") {
    throw new Error(`Migration module ${module.name} has no SQL statements`);
  }
  return {
    ...module,
    statements,
    checksum: sha256Hex(statements),
    rawChecksum: sha256Hex(module.sql),
  };
}
