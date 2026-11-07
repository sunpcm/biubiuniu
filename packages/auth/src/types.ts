import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";

import type { AuthBillingPort, AuthPolicyStore } from "./policy-store.js";

/** The Better Auth database adapter, injected by the composition layer. */
export type AuthDatabaseAdapter = NonNullable<BetterAuthOptions["database"]>;

export interface AuthSiteInfo {
  name: string;
  url: string;
}

/** Minimal Redis-compatible rate-limit storage. */
export interface RateLimitStorage {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options?: { ex?: number }): Promise<unknown>;
}

export interface AuthLogger {
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * React-free mail port. Each method is optional: a capability that requires a
 * given mail path checks that specific function at assembly and rejects when it
 * is missing.
 */
export interface AuthMailer {
  sendMagicLink?(input: { email: string; url: string }): Promise<void>;
  sendVerificationOtp?(input: {
    email: string;
    otp: string;
    type: string;
  }): Promise<void>;
  sendWelcome?(input: {
    email: string;
    name: string | null;
    unsubscribeLink: string;
  }): Promise<void>;
  sendOrganizationInvitation?(input: {
    email: string;
    url: string;
    organizationName: string;
    inviterName: string | null | undefined;
    inviterEmail: string | null | undefined;
  }): Promise<void>;
}

/** Request-context ports (source IP and cookie). */
export interface RequestSignal {
  getClientIP(): Promise<string>;
  getCookie(name: string): Promise<string | undefined>;
}

/** Signup blocklist decision, supplied by the composition layer. */
export interface SignupGuard {
  isEmailBlocked(email: string): Promise<boolean>;
  isIpBlocked(ip: string): Promise<boolean>;
}

export interface SocialProviderConfig {
  clientId: string;
  clientSecret: string;
}

/**
 * Explicitly selected capabilities. Only declared capabilities are registered;
 * a declared capability that lacks its required config is rejected clearly.
 */
export interface AuthCapabilities {
  social?: {
    github?: SocialProviderConfig;
    google?: SocialProviderConfig;
  };
  oneTap?: boolean;
  captcha?: { secretKey: string };
  magicLink?: boolean;
  emailOTP?: boolean;
  anonymous?: boolean;
  admin?: boolean;
  /** Teams/organization plugin. Requires a billing port and invitation mail. */
  organization?: boolean;
  /** Billing-aware personal deletion guard. Requires a billing port. */
  billing?: boolean;
}

export interface SignupRewardsInput {
  userId: string;
  email: string;
  ip?: string;
  deviceHash?: string;
}

export type RewardHook = (input: SignupRewardsInput) => Promise<void>;

export interface CreateAuthDeps<
  Caps extends AuthCapabilities = AuthCapabilities,
  Plugins extends readonly BetterAuthPlugin[] = readonly BetterAuthPlugin[],
> {
  site: AuthSiteInfo;
  adapter: AuthDatabaseAdapter;
  policyStore: AuthPolicyStore;
  /** Billing query capability; `null` = billing explicitly disabled. */
  billing: AuthBillingPort | null;
  /** Optional mail port (required per enabled email capability). */
  mail?: AuthMailer;
  /** Optional welcome-credits reward hook (absent = no Credits wiring). */
  reward?: RewardHook;
  signupGuard: SignupGuard;
  redis: RateLimitStorage | null;
  requestSignal: RequestSignal;
  capabilities: Caps;
  clock?: () => Date;
  /** Explicit secret; the factory rejects an empty value. */
  secret: string;
  baseURL?: string;
  /** Trusted origins for CSRF. Defaults to `[site.url]`; add localhost in dev. */
  trustedOrigins?: string[];
  /** Toggle IP-based rate limiting (window/max are fixed auth policy). */
  rateLimitEnabled?: boolean;
  /** Additional plugins (e.g. nextCookies). Kept last by the factory. */
  plugins?: Plugins;
  trackUserSource?: (user: {
    id: string;
    email: string;
    name: string | null;
  }) => Promise<void>;
  logger?: AuthLogger;
}
