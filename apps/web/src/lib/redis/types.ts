/**
 * [INPUT]: depends on nothing; pure type contracts
 * [OUTPUT]: exports RedisProviderName, RedisValue, RedisSetOptions, UnifiedRedis
 * [POS]: lib/redis type contract layer, consumed by index.ts and providers
 * [PROTOCOL]: Update this header when changed, then check CLAUDE.md
 */

export type RedisProviderName = "upstash" | "ioredis";

export type RedisValue = string | number | boolean | object | null;

export interface RedisSetOptions {
  /** Expiration time in seconds */
  ex?: number;
  /** Only set if key does not exist */
  nx?: boolean;
  /** Only set if key exists */
  xx?: boolean;
}

export interface UnifiedRedis {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: RedisValue, options?: RedisSetOptions): Promise<void>;
  /** SET NX EX — returns true when this caller won the key (first writer). */
  setNx(key: string, value: RedisValue, exSeconds: number): Promise<boolean>;
  incr(key: string): Promise<number>;
  /** EXPIRE — set a TTL in seconds on an existing key (INCR-then-EXPIRE counters); returns whether the key existed. */
  expire(key: string, seconds: number): Promise<boolean>;
  sadd(key: string, ...members: RedisValue[]): Promise<number>;
  srem(key: string, ...members: RedisValue[]): Promise<number>;
  sismember(key: string, member: RedisValue): Promise<number>;
}
