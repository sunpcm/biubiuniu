/**
 * [INPUT]: depends on @/config/site, @/lib/db/schema
 * [OUTPUT]: exports LOWER_CASE_SITE_NAME, REDIS_KEYS_CONFIGS
 * [POS]: lib/redis centralized key naming; consumed by rate-limit.ts and business code
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { siteConfig } from '@/config/site';
import { PostType } from '@/lib/db/schema';

export const LOWER_CASE_SITE_NAME = siteConfig.name.trim().toLowerCase().replace(/\s+/g, '-');

/**
 * Redis key generator - centralized key management for consistency
 */
export const REDIS_KEYS_CONFIGS = {
  post: {
    /**
     * Get post view count key
     * @example post:views:my-postType-post:en
     */
    viewCount: (postType: PostType, slug: string, locale: string) => `${LOWER_CASE_SITE_NAME}:blog:views:${postType}:${slug}:${locale}`,

    /**
     * Get post IP tracking key (for deduplication)
     * @example post:views:ip:my-postType-post:en:192.168.1.1
     */
    viewIpTracking: (postType: PostType, slug: string, locale: string, ip: string) =>
      `${LOWER_CASE_SITE_NAME}:post:views:ip:${postType}:${slug}:${locale}:${ip}`,
  },

  videoTask: {
    /** @example wenext:vtask:{taskId} */
    task: (taskId: string) => `${LOWER_CASE_SITE_NAME}:vtask:${taskId}`,
    /** @example wenext:vtask:ext:{externalId} */
    externalId: (externalId: string) => `${LOWER_CASE_SITE_NAME}:vtask:ext:${externalId}`,
  },

  billing: {
    /**
     * Credit fulfillment failure alert dedup: only one admin email per provider
     * object (invoice/session/sale) within the TTL; webhook retries and repeated
     * entries from the reconciliation cron are only logged.
     * @example wenext:billing:alert:credit-grant-failed:in_1Pz...
     */
    creditGrantFailedAlert: (providerObjectId: string) =>
      `${LOWER_CASE_SITE_NAME}:billing:alert:credit-grant-failed:${providerObjectId}`,
    /**
     * Duplicate subscription settlement alert dedup: one Discord message per
     * outcome (refunded / manual) per duplicate payment within the TTL, so the
     * webhook retries a failed refund triggers do not bombard the ops channel.
     * @example wenext:billing:alert:duplicate-subscription:stripe:in_1Pz...:manual
     */
    duplicateSubscriptionAlert: (
      provider: string,
      providerOrderId: string,
      outcome: 'refunded' | 'manual'
    ) =>
      `${LOWER_CASE_SITE_NAME}:billing:alert:duplicate-subscription:${provider}:${providerOrderId}:${outcome}`,
  },

  platform: {
    /**
     * Signup email blocklist rules (three arrays: prefixes/suffixes/exact emails),
     * persisted without a TTL; the read/write channel is lib/signup-blocklist.ts,
     * the admin entry point is /dashboard/admin/users.
     * @example wenext:platform:signup-blocklist
     */
    signupBlocklist: () => `${LOWER_CASE_SITE_NAME}:platform:signup-blocklist`,

    /**
     * Signup-gift identity-cluster counters (INCR, TTL = config/credits'
     * windowDays), one family per signal: source IP and device-fingerprint
     * hash. The read/write channel is lib/signup-gift-gate.
     * @example wenext:platform:signup-gift:ip:203.0.113.7
     * @example wenext:platform:signup-gift:device:3f9a…
     */
    signupGiftIp: (ip: string) => `${LOWER_CASE_SITE_NAME}:platform:signup-gift:ip:${ip}`,
    signupGiftDevice: (hash: string) =>
      `${LOWER_CASE_SITE_NAME}:platform:signup-gift:device:${hash}`,
  },

  // Add other modules here as needed
  // user: { ... },
  // cache: { ... },
};
