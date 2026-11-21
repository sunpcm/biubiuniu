import type { RedisProviderName } from "./types";

export type RedisProviderEnvironment = Record<string, string | undefined>;

export function selectRedisProvider(env: RedisProviderEnvironment): RedisProviderName {
  return env.DEFAULT_REDIS_PROVIDER === "ioredis" ? "ioredis" : "upstash";
}

export function resolveRedisConfiguration(env: RedisProviderEnvironment): {
  provider: RedisProviderName;
  configured: boolean;
} {
  const provider = selectRedisProvider(env);
  const configured =
    provider === "ioredis"
      ? Boolean(env.REDIS_URL)
      : Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);

  return { provider, configured };
}
