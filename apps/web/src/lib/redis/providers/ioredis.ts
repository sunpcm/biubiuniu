/**
 * [INPUT]: depends on ioredis, ../types
 * [OUTPUT]: exports ioRedis client and ioredis-specific helpers
 * [POS]: lib/redis/providers self-hosted Redis implementation (Node.js runtime only)
 * [PROTOCOL]: Update this header when changed, then check CLAUDE.md
 *
 * Note:
 * - This provider uses the ioredis driver and targets server / Vercel deployments.
 * - It does NOT work in Edge or Cloudflare Workers runtimes because ioredis relies
 *   on Node.js net. For those environments, use the Upstash provider.
 */

import "server-only";

import Redis from "ioredis";

export let ioRedis: Redis | null = null;

if (process.env.REDIS_URL) {
  try {
    ioRedis = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
    });

    ioRedis.on("error", (err) => {
      console.error("[Redis] ioredis connection error:", err.message);
    });
  } catch (error) {
    console.error("[Redis] Failed to initialize ioredis:", error);
  }
} else {
  console.log("[Redis] ioredis provider disabled: REDIS_URL is not set");
}
