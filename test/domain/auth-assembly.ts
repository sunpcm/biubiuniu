/**
 * Shared real-application assembly for the Auth domain tests.
 *
 * NOT a test file: it builds one Better Auth application through the exact
 * production composition (`apps/web/src/composition/auth`) with the real
 * `@sunpcm/niu-auth` rules and the real PostgreSQL adapters. Only the
 * infrastructure ports are swapped: a recording mail transport, an in-memory
 * Redis, a synthetic IP/cookie reader and a no-op ops logger. The same rules
 * ship in production and run here, so the two cannot drift apart.
 */

import { nextCookies, toNextJsHandler } from "better-auth/next-js";

import { db } from "@/lib/db";
import { UNKNOWN_IP } from "@/lib/ip-shared";
import type {
  RedisSetOptions,
  RedisValue,
  UnifiedRedis,
} from "@/lib/redis/types";
import type { SendEmailOptions } from "@/lib/mail/types";
import type { AuthMailer, SignupGuard } from "@sunpcm/niu-auth";
import {
  assembleAuth as assembleAuthApp,
  type AuthDb,
  createAuthPolicyStoreBound,
} from "@/composition/auth";
import { createGrantSignupRewards } from "@/lib/auth/signup-rewards";
import {
  isSignupEmailBlocked,
  isSignupIpBlocked,
} from "@/lib/signup-blocklist";

export interface RecordedEmail {
  options: SendEmailOptions;
}

/** Recording `AuthMailer`: maps each auth mail path back to a recorded
 * `SendEmailOptions` with `reactProps` so existing test assertions
 * (`mail.last()!.options.reactProps?.otp` / `...url`) keep working. */
export function createRecordingMail() {
  const sent: RecordedEmail[] = [];
  const record = (options: SendEmailOptions) => {
    sent.push({ options });
  };

  const mail: AuthMailer = {
    async sendMagicLink({ email, url }) {
      record({
        to: email,
        from: { email: "test@example.invalid" },
        subject: "Sign in",
        reactProps: { url },
      });
    },
    async sendVerificationOtp({ email, otp, type }) {
      record({
        to: email,
        from: { email: "test@example.invalid" },
        subject: "Verification code",
        reactProps: { otp, type },
      });
    },
    async sendWelcome({ email, name, unsubscribeLink }) {
      record({
        to: email,
        from: { email: "test@example.invalid" },
        subject: "Welcome",
        reactProps: { name, email, unsubscribeLink },
      });
    },
    async sendOrganizationInvitation({
      email,
      url,
      organizationName,
      inviterName,
      inviterEmail,
    }) {
      record({
        to: email,
        from: { email: "test@example.invalid" },
        subject: "Invitation",
        reactProps: { url, organizationName, inviterName, inviterEmail },
      });
    },
  };

  return {
    mail,
    last: (): RecordedEmail | undefined => sent[sent.length - 1],
    all: (): RecordedEmail[] => sent,
  };
}

/** Minimal in-memory UnifiedRedis — only used as an infrastructure fixture. */
export class InMemoryRedis implements UnifiedRedis {
  private store = new Map<string, { value: RedisValue; ttl?: number }>();

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    return entry ? (entry.value as T) : null;
  }

  async set(
    key: string,
    value: RedisValue,
    options?: RedisSetOptions,
  ): Promise<void> {
    this.store.set(key, { value, ttl: options?.ex });
  }

  async setNx(
    key: string,
    value: RedisValue,
    exSeconds: number,
  ): Promise<boolean> {
    if (this.store.has(key)) return false;
    this.store.set(key, { value, ttl: exSeconds });
    return true;
  }

  async incr(key: string): Promise<number> {
    const entry = this.store.get(key);
    const next = Number(entry?.value ?? 0) + 1;
    this.store.set(key, { value: next, ttl: entry?.ttl });
    return next;
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;
    entry.ttl = seconds;
    return true;
  }

  async sadd(key: string, ...members: RedisValue[]): Promise<number> {
    return members.length;
  }

  async srem(key: string, ...members: RedisValue[]): Promise<number> {
    return members.length;
  }

  async sismember(key: string, member: RedisValue): Promise<number> {
    return 0;
  }
}

export interface AssemblyOptions {
  redis?: UnifiedRedis | null;
  getClientIP?: () => Promise<string>;
  getCookie?: (name: string) => Promise<string | undefined>;
}

export function assembleAuth(options: AssemblyOptions = {}) {
  const { mail, last, all } = createRecordingMail();
  const redis = options.redis === undefined ? null : options.redis;
  const getClientIP = options.getClientIP ?? (async () => UNKNOWN_IP);
  const getCookie = options.getCookie ?? (async () => undefined);

  const signupGuard: SignupGuard = {
    isEmailBlocked: (email) => isSignupEmailBlocked(email, undefined, redis),
    isIpBlocked: (ip) => isSignupIpBlocked(ip, undefined, redis),
  };

  const reward = createGrantSignupRewards({
    redis,
    notifySignupGiftWithheld: async () => {},
    logger: { warn: () => {}, error: () => {} },
  });

  const authDb = db as unknown as AuthDb;
  const { policyStore, billing } = createAuthPolicyStoreBound(authDb);

  const auth = assembleAuthApp({
    db: authDb,
    policyStore,
    billing,
    mail,
    reward,
    signupGuard,
    requestSignal: { getClientIP, getCookie },
    redis,
    capabilities: {
      emailOTP: true,
      magicLink: true,
      anonymous: true,
      admin: true,
      organization: true,
      billing: true,
    },
    secret: process.env.BETTER_AUTH_SECRET || "test-only-secret",
    baseURL:
      process.env.NEXT_PUBLIC_BETTER_AUTH_URL ||
      process.env.NEXT_PUBLIC_SITE_URL,
    plugins: [nextCookies()],
  });

  const handler = toNextJsHandler(auth);

  return { auth, handler, mail: { last, all } };
}

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3000";
}

export function authBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "http://127.0.0.1:3000"
  );
}
