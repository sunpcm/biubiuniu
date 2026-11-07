/**
 * Migration module and profile contracts.
 *
 * A module is an immutable SQL unit. Its `checksum` is the SHA-256 of the
 * normalized statement stream (split on the drizzle statement breakpoint,
 * trimmed, joined with `;\n`), and `rawChecksum` is the SHA-256 of the exact
 * source string. Both are recorded in the journal for drift detection.
 */

export interface MigrationModule {
  /** Stable, globally unique module identity. */
  name: string;
  /** Integer version; a change must append a new module, never bump in place. */
  version: number;
  /**
   * Physical database contract version this module's SQL produces once applied.
   *
   * This is deliberately separate from `version` (immutable module identity)
   * and from the npm package version. A breaking schema change appends a new
   * module with a higher `contractVersion`; an additive module reuses the
   * current contract version. A read-only consumer rejects a database whose
   * recorded contract version is outside its supported range.
   */
  contractVersion: number;
  description: string;
  /** Names of modules that must be applied first. */
  dependencies: readonly string[];
  /** Raw SQL with `--> statement-breakpoint` separators between statements. */
  sql: string;
}

export interface ResolvedModule extends MigrationModule {
  /** Executable statement stream (breakpoints removed, joined with `;\n`). */
  statements: string;
  /** SHA-256 of `statements` — the authoritative identity. */
  checksum: string;
  /** SHA-256 of the raw SQL — supplementary integrity. */
  rawChecksum: string;
}

export interface MigrationProfile {
  name: string;
  description: string;
  /** Explicit, unordered set of module names. The planner resolves order. */
  modules: readonly string[];
}

export interface MigrationPlan {
  profile: string;
  modules: ResolvedModule[];
}

export interface MigrationReport {
  profile: string;
  applied: string[];
  skipped: string[];
  verified: string[];
  modules: ResolvedModule[];
}

/**
 * Result of a read-only compatibility check.
 *
 * `compatible` is true only when every module in the plan is already applied
 * with a matching `version`, statement `checksum`, and `rawChecksum`.
 */
export interface MigrationCompatibility {
  profile: string;
  compatible: boolean;
  /** Modules present in the journal with matching version/checksum/raw. */
  applied: string[];
  /** Modules in the plan but absent from the journal. */
  missing: string[];
  /** Modules present but with a drifted version/checksum/raw fingerprint. */
  incompatible: string[];
  /** Declared sentinel tables/columns for the plan that are absent from the physical schema. */
  missingTables: string[];
  /** Effective database contract version recorded in the journal, when one exists. */
  databaseContractVersion?: number;
  /** Contract versions this consumer declares support for. */
  supportedContractVersions: number[];
  /** True when the recorded database contract version is outside the supported set. */
  contractVersionMismatch: boolean;
}
