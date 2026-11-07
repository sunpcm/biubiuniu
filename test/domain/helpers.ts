import postgres from "postgres";
import { runMigrations } from "@/lib/db/migration-runner";
import type { MigrationReport } from "@/lib/db/migration-types";

export interface IsolationTarget {
  database: string;
  role: string;
}

export const EXPECTED_ROLE = "nexty_overnight_test";

/** The only domain application database this run may touch. */
export const DOMAIN_TEST_DATABASE = "nexty_overnight_20261105_n4_app";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set; domain tests need controller-injected PG runtime env`,
    );
  }
  return value;
}

export function domainExpectedDatabase(): string {
  const expected = requireEnv("DOMAIN_TEST_EXPECTED_DATABASE");
  if (expected !== DOMAIN_TEST_DATABASE) {
    throw new Error(
      `DOMAIN_TEST_EXPECTED_DATABASE must be exactly "${DOMAIN_TEST_DATABASE}" (got "${expected}")`,
    );
  }
  return expected;
}

export function domainExpectedPort(): number {
  const raw = requireEnv("DOMAIN_TEST_EXPECTED_PORT");
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(
      `DOMAIN_TEST_EXPECTED_PORT must be a valid TCP port (got "${raw}")`,
    );
  }
  return port;
}

export function assertLoopback(url: URL, expectedPort?: number): void {
  if (url.hostname !== "127.0.0.1") {
    throw new Error(`PG URL host must be 127.0.0.1 (got "${url.hostname}")`);
  }
  const port = url.port ? Number(url.port) : 5432;
  if (expectedPort !== undefined && port !== expectedPort) {
    throw new Error(
      `PG URL port must match DOMAIN_TEST_EXPECTED_PORT ${expectedPort} (got ${port})`,
    );
  }
}

/**
 * Strict pre-connection guard for every controller-injected PG URL. It runs
 * before `postgres(...)` opens a socket, so a wrong protocol, non-loopback
 * host, wrong controller port, wrong pathname (database) or wrong fixed role
 * fails closed with zero connection side effects. `expectedDatabase` is the
 * only caller-varying input; the role is a fixed constant and cannot be
 * overridden by an optional argument or environment variable.
 */
export function assertPostgresUrl(raw: string, expectedDatabase: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("PG URL is not a valid URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(
      `PG URL protocol must be postgres/postgresql (got "${url.protocol}")`,
    );
  }
  assertLoopback(url, domainExpectedPort());
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (database !== expectedDatabase) {
    throw new Error(
      `PG URL database must be "${expectedDatabase}" (got "${database || "(none)"}")`,
    );
  }
  const role = decodeURIComponent(url.username);
  if (role !== EXPECTED_ROLE) {
    throw new Error(
      `PG URL role must be "${EXPECTED_ROLE}" (got "${role || "(none)"}")`,
    );
  }
  return raw;
}

export function assertIsolatedTarget(actualDatabase: string, actualRole: string): void {
  if (actualDatabase !== domainExpectedDatabase()) {
    throw new Error(
      `Refusing to run against unexpected database "${actualDatabase}" (expected ${domainExpectedDatabase()})`,
    );
  }
  if (actualRole !== EXPECTED_ROLE) {
    throw new Error(
      `Refusing to run as unexpected role "${actualRole}" (expected ${EXPECTED_ROLE})`,
    );
  }
}

export function databaseUrl(): string {
  return assertPostgresUrl(requireEnv("DATABASE_URL"), domainExpectedDatabase());
}

export type { MigrationReport };

/**
 * Consume the canonical runner instead of keeping a second copy of the
 * migration algorithm. The guard keeps the shared reference database strictly
 * isolated to the controller-confirmed new application database / role.
 */
export async function migrate(schema: "public" = "public"): Promise<MigrationReport> {
  return runMigrations({
    url: databaseUrl(),
    schema,
    guard: assertIsolatedTarget,
  });
}

export async function resetSyntheticData(schema: "public" = "public"): Promise<void> {
  const sql = postgres(databaseUrl(), { max: 1 });
  const q = (id: string) => (schema === "public" ? `"${id}"` : `"${schema}"."${id}"`);
  try {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('nexty-n2-reset'))`;
      const [row] = await tx<{ database: string; role: string }[]>`
        select current_database() as database, current_user as role
      `;
      assertIsolatedTarget(row.database, row.role);
      await tx.unsafe(
        `truncate table
          ${q("credit_transactions")},
          ${q("organization_credit_balances")},
          ${q("credit_balances")},
          ${q("orders")},
          ${q("subscriptions")},
          ${q("member")},
          ${q("invitation")},
          ${q("organization")},
          ${q("session")},
          ${q("account")},
          ${q("verification")},
          ${q("user_source")},
          ${q("feedback_replies")},
          ${q("feedback")},
          ${q("post_tags")},
          ${q("tags")},
          ${q("posts")},
          ${q("user")}
          restart identity cascade`,
      );
    });
  } finally {
    await sql.end();
  }
}
