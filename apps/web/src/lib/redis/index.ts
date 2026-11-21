/**
 * [INPUT]: depends on provider implementations and ../types
 * [OUTPUT]: exports redis (unified client), getDefaultRedisProvider, provider-specific clients, rate limiting; re-exports IP helpers from lib/ip
 * [POS]: lib/redis unified entry point; replaces direct @upstash/redis usage
 * [PROTOCOL]: Update this header when changed, then check CLAUDE.md
 */

import "server-only";

import { getDefaultRedisProvider } from "./provider";
import { ioRedis } from "./providers/ioredis";
import { upstashRedis } from "./providers/upstash";
import type {
  RedisProviderName,
  RedisSetOptions,
  RedisValue,
  UnifiedRedis,
} from "./types";

export { getDefaultRedisProvider } from "./provider";
export {
  checkRateLimit,
  RATE_LIMIT_CONFIGS,
  type RateLimitConfig,
} from "./rate-limit";
export {
  getClientIPFromHeaders,
  getClientIPFromRequest,
} from "../ip";

function serialize(value: RedisValue): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function deserialize<T>(raw: string | null): T | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

class UnifiedRedisClient implements UnifiedRedis {
  private provider: RedisProviderName;

  constructor(provider: RedisProviderName) {
    this.provider = provider;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    if (this.provider === "upstash") {
      if (!upstashRedis) return null;
      return upstashRedis.get<T>(key);
    }

    if (!ioRedis) return null;
    const raw = await ioRedis.get(key);
    return deserialize<T>(raw);
  }

  async set(
    key: string,
    value: RedisValue,
    options?: RedisSetOptions
  ): Promise<void> {
    if (this.provider === "upstash") {
      if (!upstashRedis) return;
      // Upstash SetCommandOptions is a strict union; build opts dynamically to avoid combinatorial branching
      const opts: Record<string, unknown> = {};
      if (options?.ex !== undefined) opts.ex = options.ex;
      if (options?.nx) opts.nx = true;
      else if (options?.xx) opts.xx = true;
      await upstashRedis.set(
        key,
        value,
        Object.keys(opts).length > 0 ? (opts as any) : undefined
      );
      return;
    }

    if (!ioRedis) return;
    const serialized = serialize(value);
    // ioredis uses positional args for SET sub-commands
    const args: (string | number)[] = [key, serialized];
    if (options?.ex !== undefined) args.push("EX", options.ex);
    if (options?.nx) args.push("NX");
    else if (options?.xx) args.push("XX");
    await ioRedis.call("SET", ...args);
  }

  async setNx(
    key: string,
    value: RedisValue,
    exSeconds: number
  ): Promise<boolean> {
    if (this.provider === "upstash") {
      if (!upstashRedis) return false;
      const result = await upstashRedis.set(key, serialize(value), {
        ex: exSeconds,
        nx: true,
      });
      return result === "OK";
    }

    if (!ioRedis) return false;
    const result = await ioRedis.call(
      "SET",
      key,
      serialize(value),
      "EX",
      exSeconds,
      "NX"
    );
    return result === "OK";
  }

  async incr(key: string): Promise<number> {
    if (this.provider === "upstash") {
      if (!upstashRedis) return 0;
      return upstashRedis.incr(key);
    }

    if (!ioRedis) return 0;
    const result = await ioRedis.incr(key);
    return typeof result === "number" ? result : Number(result);
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    if (this.provider === "upstash") {
      if (!upstashRedis) return false;
      const result = await upstashRedis.expire(key, seconds);
      return Number(result) === 1;
    }

    if (!ioRedis) return false;
    const result = await ioRedis.expire(key, seconds);
    return Number(result) === 1;
  }

  async sadd(key: string, ...members: RedisValue[]): Promise<number> {
    const args = members.map((m) => String(m));
    if (args.length === 0) return 0;
    const [first, ...rest] = args;

    if (this.provider === "upstash") {
      if (!upstashRedis) return 0;
      return upstashRedis.sadd(key, first, ...rest);
    }

    if (!ioRedis) return 0;
    return ioRedis.sadd(key, first, ...rest);
  }

  async srem(key: string, ...members: RedisValue[]): Promise<number> {
    const args = members.map((m) => String(m));
    if (args.length === 0) return 0;
    const [first, ...rest] = args;

    if (this.provider === "upstash") {
      if (!upstashRedis) return 0;
      return upstashRedis.srem(key, first, ...rest);
    }

    if (!ioRedis) return 0;
    return ioRedis.srem(key, first, ...rest);
  }

  async sismember(key: string, member: RedisValue): Promise<number> {
    if (this.provider === "upstash") {
      if (!upstashRedis) return 0;
      const result = await upstashRedis.sismember(key, member);
      return typeof result === "number" ? result : Number(result);
    }

    if (!ioRedis) return 0;
    const result = await ioRedis.sismember(key, String(member));
    return typeof result === "number" ? result : Number(result);
  }
}

function createUnifiedRedis(): UnifiedRedis | null {
  const provider = getDefaultRedisProvider();

  if (provider === "upstash") {
    return upstashRedis ? new UnifiedRedisClient("upstash") : null;
  }

  if (provider === "ioredis") {
    return ioRedis ? new UnifiedRedisClient("ioredis") : null;
  }

  return null;
}

export const redis = createUnifiedRedis();

export { ioRedis } from "./providers/ioredis";
export { upstashRedis } from "./providers/upstash";
export * from "./types";
