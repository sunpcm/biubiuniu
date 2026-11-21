# lib/redis/
> L2 | Parent: /CLAUDE.md

Multi-provider Redis abstraction (Upstash REST + self-hosted via ioredis). All business code imports from lib/redis; the provider is chosen by DEFAULT_REDIS_PROVIDER (default: upstash).

Files
- types.ts: Shared contracts — RedisProviderName, RedisValue, RedisSetOptions, UnifiedRedis.
- provider.ts: Provider selection helper getDefaultRedisProvider.
- providers/upstash.ts: Upstash REST implementation (@upstash/redis) — works in serverless and Edge runtimes.
- providers/ioredis.ts: Self-hosted implementation (ioredis) — Node.js server / Vercel only, does not run on Edge or Workers.
- index.ts: Unified entry point — `redis` delegates get/set/setNx/incr/expire/sadd/srem/sismember to the selected provider, exposes the native clients, and re-exports the IP helpers from lib/ip.ts.
- rate-limit.ts: Provider-aware rate limiting plus RATE_LIMIT_CONFIGS presets — sliding window on Upstash (@upstash/ratelimit), fixed window via INCR + EXPIRE on ioredis.
- redis-keys.ts: Centralized key naming (LOWER_CASE_SITE_NAME, REDIS_KEYS_CONFIGS: billing alert dedup, platform.signupBlocklist, platform.signupGiftIp / signupGiftDevice cluster counters).

Design rules
- Provider-specific quirks (serialization, argument order, connection handling) stay inside providers/.
- setNx returns whether this caller won the key (SET NX EX) — the primitive behind cross-instance dedup and locks, e.g. billing alert dedup.
- expire returns whether the key existed, so an INCR-then-EXPIRE counter can tell a fresh window from a vanished key instead of guessing.
- The ioredis fixed window can allow up to 2x the configured quota at window boundaries; callers should size limits accordingly.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
