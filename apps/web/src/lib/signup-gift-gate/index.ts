/**
 * [INPUT]: Depends on @/config/credits' signupGiftClusterCaps (two caps + window
 *          days), the injected redis client and REDIS_KEYS_CONFIGS.platform.signupGiftIp /
 *          signupGiftDevice, @/lib/ip-shared's UNKNOWN_IP sentinel, ./shared's isValidDeviceHash
 * [OUTPUT]: Exports decideSignupGift (the single signup-gift decision: INCR
 *           counters on the IP and on the device fingerprint, either past its cap
 *           gives grant=false with a reason; missing signals or a Redis failure
 *           always give grant=true), readDeviceSignalCookie (cookie value -> valid
 *           hash or undefined), the SignupGiftDecision and SignupGiftWithheldReason types
 * [POS]: The server half of lib/signup-gift-gate, called by lib/auth/signup-rewards
 *        before the gift is granted. Division of labour with lib/signup-blocklist:
 *        the blocklist refuses the signup, this module only withholds the gift
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */
import { creditsConfig } from '@/config/credits'
import { UNKNOWN_IP } from '@/lib/ip-shared'
import { REDIS_KEYS_CONFIGS } from '@/lib/redis/redis-keys'
import type { UnifiedRedis } from '@/lib/redis/types'

import { isValidDeviceHash } from './shared'

export type SignupGiftWithheldReason = 'ip_cap' | 'device_cap'

export interface SignupGiftDecision {
  grant: boolean
  reason?: SignupGiftWithheldReason
  /** The signals counted this time and the counts after counting, for logs and the ops notification */
  ip?: string
  deviceHash?: string
  ipCount?: number
  deviceCount?: number
}

interface ClusterSignal {
  reason: SignupGiftWithheldReason
  key: string
  cap: number
}

// ─────────────────────────────────────────────────────────────
// Cookie read: client-controlled input, only a well-formed hash is accepted
// ─────────────────────────────────────────────────────────────
export function readDeviceSignalCookie(value: string | undefined): string | undefined {
  return isValidDeviceHash(value) ? value : undefined
}

// ─────────────────────────────────────────────────────────────
// Decision: each signal gets its own INCR, the TTL is attached on first
// write, and either signal past its cap withholds the gift.
//
// What is counted is signups, not gifts. From the N+1th account in a cluster
// on, nothing is granted regardless of what earlier accounts received: one
// person cycling emails gets a gift on the first few accounts and nothing
// after, the counter keeps climbing, and "no gift" never resets the chance
// inside the window.
// ─────────────────────────────────────────────────────────────
export async function decideSignupGift(
  params: {
    ip?: string
    deviceHash?: string
  },
  redisClient: UnifiedRedis | null
): Promise<SignupGiftDecision> {
  const { perIp, perDevice, windowDays } = creditsConfig.signupGiftClusterCaps
  const ip = params.ip && params.ip !== UNKNOWN_IP ? params.ip.trim() : undefined
  const deviceHash = readDeviceSignalCookie(params.deviceHash)

  const signals: ClusterSignal[] = []
  if (ip) {
    signals.push({ reason: 'ip_cap', key: REDIS_KEYS_CONFIGS.platform.signupGiftIp(ip), cap: perIp })
  }
  if (deviceHash) {
    signals.push({
      reason: 'device_cap',
      key: REDIS_KEYS_CONFIGS.platform.signupGiftDevice(deviceHash),
      cap: perDevice,
    })
  }

  const decision: SignupGiftDecision = { grant: true, ip, deviceHash }
  if (!redisClient || signals.length === 0) return decision

  try {
    const windowSeconds = windowDays * 24 * 60 * 60
    for (const signal of signals) {
      const count = await redisClient.incr(signal.key)
      if (count === 1) await redisClient.expire(signal.key, windowSeconds)
      if (signal.reason === 'ip_cap') decision.ipCount = count
      else decision.deviceCount = count
      // Count both signals before deciding: even when the IP is already past
      // its cap the device counter must advance, so the device ledger stays
      // continuous when the same machine comes back on another IP
      if (count > signal.cap && decision.grant) {
        decision.grant = false
        decision.reason = signal.reason
      }
    }
    return decision
  } catch {
    // A Redis failure lets the gift through: a broken gate must not leave a genuine new user empty-handed
    return { grant: true, ip, deviceHash }
  }
}
