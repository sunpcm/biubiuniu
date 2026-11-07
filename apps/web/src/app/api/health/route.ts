/**
 * [INPUT]: Depends on @/lib/db's db + isDatabaseEnabled, @/lib/redis's redis,
 *          @/lib/logger's getLogger, drizzle-orm's sql
 * [OUTPUT]: Exports GET — the /api/health liveness + readiness probe
 * [POS]: The uptime entry of app/api/health: one unauthenticated endpoint that pings every
 *        backing service in parallel and folds the results into a single HTTP status, so
 *        load balancers, uptime monitors and container orchestrators share one contract
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 *
 * ============================================================================
 * Contract:
 *
 *   GET /api/health  ->  200 { status: 'ok',    at, uptimeSec, checks }
 *                        503 { status: 'error', at, uptimeSec, checks }
 *
 *   checks[name] = { status: 'ok' | 'down' | 'skipped', latencyMs }
 *
 *   - 'skipped' means the dependency is not configured in this deployment
 *     (the template ships without Redis, for instance) — never a failure.
 *   - Only 'down' turns the whole probe red. A monitor therefore alerts on the
 *     HTTP status alone and never has to parse the body.
 *
 * Deliberately public and deliberately opaque: the endpoint takes no secret so any
 * probe can reach it, and it returns no error strings, versions or hostnames back —
 * failure details go to the logger, not to the caller.
 *
 * Every probe is capped by CHECK_TIMEOUT_MS so a hung TCP connection degrades into a
 * 'down' result instead of holding the request open until the platform kills it.
 *
 * Adding a dependency = appending one entry to CHECKS. No branching anywhere else.
 * ============================================================================
 */

import { db, isDatabaseEnabled } from "@/lib/db";
import { evaluateHealthChecks, type HealthCheck } from "@/lib/health";
import { getLogger } from "@/lib/logger";
import { redis } from "@/lib/redis";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const logger = getLogger("api:health");

// A probe is a network round-trip, not a computation: this is the whole budget
// each dependency gets before it is declared down.
const CHECK_TIMEOUT_MS = 3_000;

// Read-only key, never written. Its absence is a perfectly healthy answer — what
// is being measured is the round-trip, not the value.
const REDIS_PROBE_KEY = "health:probe";

// Local alias: TypeScript narrows a const binding into the closure below, an
// imported one it does not.
const redisClient = redis;

const CHECKS: HealthCheck[] = [
  {
    name: "database",
    probe: isDatabaseEnabled ? () => db.execute(sql`select 1`) : null,
  },
  {
    name: "redis",
    probe: redisClient ? () => redisClient.get(REDIS_PROBE_KEY) : null,
  },
];

export async function GET() {
  const { checks, healthy } = await evaluateHealthChecks(CHECKS, {
    timeoutMs: CHECK_TIMEOUT_MS,
    onFailure: (check, error) => {
      // The response exposes only 'down'; failure details stay in operator logs.
      logger.warn({ err: error, check: check.name }, "health check failed");
    },
  });

  return NextResponse.json(
    {
      status: healthy ? "ok" : "error",
      at: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      checks,
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
