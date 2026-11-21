/**
 * [INPUT]: depends on @upstash/redis, ../types
 * [OUTPUT]: exports upstashRedis client
 * [POS]: lib/redis/providers Upstash REST implementation (serverless / Edge compatible)
 * [PROTOCOL]: Update this header when changed, then check CLAUDE.md
 */

import "server-only";

import { Redis } from "@upstash/redis";

export let upstashRedis: Redis | null = null;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  upstashRedis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
} else {
  console.log(
    "[Redis] Upstash provider disabled: UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is not set"
  );
}
