/**
 * [INPUT]: depends on ./types
 * [OUTPUT]: exports getDefaultRedisProvider
 * [POS]: lib/redis provider selection helper, consumed by index.ts and rate-limit.ts
 * [PROTOCOL]: Update this header when changed, then check CLAUDE.md
 */

import "server-only";

import type { RedisProviderName } from "./types";
import { selectRedisProvider, type RedisProviderEnvironment } from "./provider-selection";

export function getDefaultRedisProvider(): RedisProviderName {
  return selectRedisProvider(process.env as RedisProviderEnvironment);
}
