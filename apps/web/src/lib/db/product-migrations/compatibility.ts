import {
  checkProfileCompatibility,
  type MigrationCompatibility,
  type MigrationRunnerOptions,
} from "@sunpcm/niu-persistence-pg/migrations";
import { PRODUCT_MIGRATION_PLAN } from "./index";

export const PRODUCT_SCHEMA_SENTINELS = {
  tables: ["feedback", "feedback_replies", "post_tags", "posts", "tags"],
  enums: [
    "feedback_priority",
    "feedback_status",
    "feedback_type",
    "post_status",
    "post_type",
    "post_visibility",
  ],
} as const;

interface DatabaseTarget {
  database: string;
  role: string;
  port: number;
}

function requireProductDatabaseUrl(rawUrl = process.env.DATABASE_URL): string {
  if (!rawUrl?.trim()) {
    throw new Error("DATABASE_URL is required for the product database");
  }
  const url = rawUrl.trim();

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      throw new Error();
    }
    const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    const role = decodeURIComponent(parsed.username);
    const port = Number(parsed.port || "5432");
    if (
      !parsed.hostname ||
      !database ||
      database.includes("/") ||
      !role ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      throw new Error();
    }
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }

  return url;
}

function fixedTarget(url: string): DatabaseTarget {
  const parsed = new URL(url);
  return {
    database: decodeURIComponent(parsed.pathname.replace(/^\/+/, "")),
    role: decodeURIComponent(parsed.username),
    port: Number(parsed.port || "5432"),
  };
}

function targetGuard(target: DatabaseTarget): (database: string, role: string) => void {
  return (database, role) => {
    if (database !== target.database) {
      throw new Error("Product database identity mismatch: database");
    }
    if (role !== target.role) {
      throw new Error("Product database identity mismatch: role");
    }
  };
}

export function productMigrationOptions(rawUrl?: string): MigrationRunnerOptions {
  const url = requireProductDatabaseUrl(rawUrl);
  const target = fixedTarget(url);
  return {
    url,
    profile: PRODUCT_MIGRATION_PLAN.profile.name,
    modules: PRODUCT_MIGRATION_PLAN.modules,
    roots: PRODUCT_MIGRATION_PLAN.roots,
    guard: targetGuard(target),
    sentinels: PRODUCT_SCHEMA_SENTINELS,
  };
}

export function checkProductDatabaseCompatibility(
  rawUrl?: string,
): Promise<MigrationCompatibility> {
  return checkProfileCompatibility({
    ...productMigrationOptions(rawUrl),
    requireProfileActivation: true,
  });
}

function safeCompatibilityFailure(result: MigrationCompatibility): string {
  const details: string[] = [];
  if (result.missing.length > 0) {
    details.push(`missingModules=${result.missing.join(",")}`);
  }
  if (result.incompatible.length > 0) {
    details.push(`incompatibleModules=${result.incompatible.join(",")}`);
  }
  if (result.missingTables.length > 0) {
    details.push(`missingObjects=${result.missingTables.join(",")}`);
  }
  if (result.contractVersionMismatch) {
    details.push("contractVersionMismatch");
  }
  return details.length > 0
    ? `Product database compatibility check failed safely: ${details.join("; ")}`
    : "Product database compatibility check failed safely";
}

/** Startup gate: read-only, fail closed, and safe to surface in server logs. */
export async function assertProductDatabaseCompatibility(
  rawUrl?: string,
): Promise<MigrationCompatibility> {
  let result: MigrationCompatibility;
  try {
    result = await checkProductDatabaseCompatibility(rawUrl);
  } catch {
    throw new Error("Product database compatibility check could not complete safely");
  }
  if (!result.compatible) {
    throw new Error(safeCompatibilityFailure(result));
  }
  return result;
}
