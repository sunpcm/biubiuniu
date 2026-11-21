/**
 * [INPUT]: depends on @upstash/ratelimit, ./provider, ./providers/upstash, ./providers/ioredis, ./redis-keys
 * [OUTPUT]: exports RateLimitConfig, RATE_LIMIT_CONFIGS, checkRateLimit
 * [POS]: lib/redis rate-limiting layer, provider-aware (Upstash sliding-window / ioredis fixed-window); preset configs co-located
 * [PROTOCOL]: Update this header when changed, then check CLAUDE.md
 */

import "server-only";

import { Duration, Ratelimit } from "@upstash/ratelimit";
import { getDefaultRedisProvider } from "./provider";
import { ioRedis } from "./providers/ioredis";
import { upstashRedis } from "./providers/upstash";
import { LOWER_CASE_SITE_NAME } from "./redis-keys";

export interface RateLimitConfig {
  prefix: string;
  maxRequests: number;
  /**
   * Time window, e.g. "10 s", "1 m", "1 h", "1 d".
   *
   * Underlying algorithm depends on the active provider:
   * - Upstash: sliding window (precise).
   * - ioredis: fixed window (simpler; can allow 2x quota at window boundaries).
   */
  window: string;
}

// ─── Preset Configs ──────────────────────────────────────────────

function rlPrefix(name: string): string {
  return `${LOWER_CASE_SITE_NAME}:rl:${name}`;
}

export const RATE_LIMIT_CONFIGS = {
  anonymousUpload: {
    prefix: rlPrefix("anonymous-upload"),
    maxRequests: 100,
    window: "1 d",
  },
  anonymousDownload: {
    prefix: rlPrefix("anonymous-download"),
    maxRequests: 100,
    window: "1 d",
  },
  newsletter: {
    prefix: rlPrefix("newsletter"),
    maxRequests: 10,
    window: "1 d",
  },
} satisfies Record<string, RateLimitConfig>;

// ─── Internal ────────────────────────────────────────────────────

const limiters = new Map<string, Ratelimit>();

const SECONDS_MULTIPLIER: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

function parseWindowToSeconds(window: string): number {
  const [amount, unit] = window.split(" ");
  const multiplier = SECONDS_MULTIPLIER[unit];
  if (multiplier === undefined) {
    throw new Error(`Invalid duration unit: "${unit}". Use s, m, h, or d.`);
  }
  return parseInt(amount) * multiplier;
}

function getOrCreateLimiter(config: RateLimitConfig): Ratelimit | null {
  if (!upstashRedis || getDefaultRedisProvider() !== "upstash") {
    return null;
  }

  const cacheKey = `${config.prefix}:${config.maxRequests}:${config.window}`;

  if (!limiters.has(cacheKey)) {
    limiters.set(
      cacheKey,
      new Ratelimit({
        redis: upstashRedis,
        limiter: Ratelimit.slidingWindow(
          config.maxRequests,
          config.window as Duration
        ),
        prefix: config.prefix,
      })
    );
  }

  return limiters.get(cacheKey)!;
}

async function checkUpstashRateLimit(
  identifier: string,
  config: RateLimitConfig
): Promise<boolean> {
  const limiter = getOrCreateLimiter(config);
  if (!limiter) return true;

  const { success } = await limiter.limit(identifier);
  return success;
}

async function checkIoredisRateLimit(
  identifier: string,
  config: RateLimitConfig
): Promise<boolean> {
  if (!ioRedis) return true;

  const windowSeconds = parseWindowToSeconds(config.window);
  const windowIndex = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `${config.prefix}:${identifier}:${windowIndex}`;

  const pipeline = ioRedis.pipeline();
  pipeline.incr(key);
  pipeline.expire(key, windowSeconds);
  const results = await pipeline.exec();

  if (!results) return true;

  const [err, count] = results[0];
  if (err) {
    console.error("[Redis] ioredis rate limit error:", err);
    return true;
  }

  return Number(count) <= config.maxRequests;
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Check whether the request is within the rate limit.
 * @returns true = allowed, false = exceeded
 */
export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): Promise<boolean> {
  const provider = getDefaultRedisProvider();

  if (provider === "upstash") {
    return checkUpstashRateLimit(identifier, config);
  }

  if (provider === "ioredis") {
    return checkIoredisRateLimit(identifier, config);
  }

  return true;
}
