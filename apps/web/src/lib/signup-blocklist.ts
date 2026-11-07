/**
 * [INPUT]: Depends on the injected redis client and
 *          REDIS_KEYS_CONFIGS.platform.signupBlocklist, @/lib/email for normalizeEmail
 * [OUTPUT]: Exports the SignupBlocklistConfig type (email prefix / suffix / exact + IP,
 *          four rule groups), getSignupBlocklist / saveSignupBlocklist
 *          (the sole Redis read/write channel; a failed read silently falls back to empty
 *          rules — a blocklist failure must never block legitimate signups),
 *          isSignupEmailBlocked (the signup hook's match test: prefix/suffix/exact rules
 *          compared against both the raw lowercased form and the normalizeEmail canonical
 *          form, defeating gmail dot / +suffix variant bypass; takes an already-read config
 *          to save a Redis round trip), isSignupIpBlocked (the signup hook's IP test:
 *          exact match, an IPv4-mapped IPv6 with the ::ffff: prefix is normalized to plain
 *          IPv4 first)
 * [POS]: The signup email / IP blocklist layer of lib; read by lib/auth/index.ts's
 *        user.create.before hook, written by actions/users/signup-blocklist.ts
 *        (admin save, entry point /dashboard/admin/users)
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */
import { normalizeEmail } from '@/lib/email'
import { REDIS_KEYS_CONFIGS } from '@/lib/redis/redis-keys'
import type { UnifiedRedis } from '@/lib/redis/types'

export interface SignupBlocklistConfig {
  /** Email prefix (e.g. "spam" matches spam123@gmail.com) */
  prefixes: string[]
  /** Email suffix (e.g. "@tempmail.com" or ".ru") */
  suffixes: string[]
  /** Exact full email address */
  exact: string[]
  /** IPs that may not register (exact match; ::ffff:1.2.3.4 IPv4-mapped IPv6 is normalized before comparing) */
  ips: string[]
}

export const EMPTY_SIGNUP_BLOCKLIST: SignupBlocklistConfig = {
  prefixes: [],
  suffixes: [],
  exact: [],
  ips: [],
}

function sanitizeRules(rules: unknown): string[] {
  if (!Array.isArray(rules)) return []
  return [
    ...new Set(
      rules
        .filter((rule): rule is string => typeof rule === 'string')
        .map((rule) => rule.trim().toLowerCase())
        .filter(Boolean)
    ),
  ]
}

// An IPv4-mapped IPv6 (::ffff:1.2.3.4) becomes plain IPv4 so it compares with
// the IPv4 rules an admin types
function normalizeIp(ip: string): string {
  const lower = ip.trim().toLowerCase()
  return lower.startsWith('::ffff:') ? lower.slice('::ffff:'.length) : lower
}

export function sanitizeSignupBlocklist(
  config: Partial<SignupBlocklistConfig>
): SignupBlocklistConfig {
  return {
    prefixes: sanitizeRules(config.prefixes),
    suffixes: sanitizeRules(config.suffixes),
    exact: sanitizeRules(config.exact),
    ips: sanitizeRules(config.ips).map(normalizeIp),
  }
}

/** Reads the rules currently in effect. Any Redis failure silently falls back to empty
 *  rules — a failure of the blocklist itself must never block legitimate signups. */
export async function getSignupBlocklist(
  redisClient: UnifiedRedis | null
): Promise<SignupBlocklistConfig> {
  try {
    const stored = await redisClient?.get<Partial<SignupBlocklistConfig>>(
      REDIS_KEYS_CONFIGS.platform.signupBlocklist()
    )
    if (!stored) return EMPTY_SIGNUP_BLOCKLIST
    return sanitizeSignupBlocklist(stored)
  } catch {
    return EMPTY_SIGNUP_BLOCKLIST
  }
}

/** Persists the rules (no TTL — they stay in effect until the next save). */
export async function saveSignupBlocklist(
  config: SignupBlocklistConfig,
  redisClient: UnifiedRedis | null
): Promise<void> {
  await redisClient?.set(
    REDIS_KEYS_CONFIGS.platform.signupBlocklist(),
    sanitizeSignupBlocklist(config)
  )
}

function matchesBlocklist(email: string, config: SignupBlocklistConfig): boolean {
  return (
    config.exact.includes(email) ||
    config.prefixes.some((prefix) => email.startsWith(prefix)) ||
    config.suffixes.some((suffix) => email.endsWith(suffix))
  )
}

/**
 * Compares both the raw lowercased form and the normalizeEmail canonical form,
 * defeating gmail dot / +suffix variant bypass. config may be passed in by a
 * caller that already read the rules, saving a Redis round trip.
 */
export async function isSignupEmailBlocked(
  email: string,
  config?: SignupBlocklistConfig,
  redisClient?: UnifiedRedis | null
): Promise<boolean> {
  config = config ?? (await getSignupBlocklist(redisClient ?? null))
  if (!config.prefixes.length && !config.suffixes.length && !config.exact.length) {
    return false
  }
  const raw = email.trim().toLowerCase()
  if (matchesBlocklist(raw, config)) return true
  const normalized = normalizeEmail(email)
  return normalized !== raw && matchesBlocklist(normalized, config)
}

/**
 * Whether the signup IP is blocklisted: exact match (the save path already
 * normalized ::ffff: mappings to plain IPv4, the source IP gets the same
 * treatment here). Callers skip the check when no source IP is available
 * (a direct connection without proxy headers), so nothing is blocked blindly.
 * config may be passed in by a caller that already read the rules.
 */
export async function isSignupIpBlocked(
  ip: string,
  config?: SignupBlocklistConfig,
  redisClient?: UnifiedRedis | null
): Promise<boolean> {
  config = config ?? (await getSignupBlocklist(redisClient ?? null))
  if (!config.ips.length) return false
  return config.ips.includes(normalizeIp(ip))
}
