/**
 * Auth composition — the single assembly location for the Better Auth
 * application, shared by the production entry (`lib/auth/index.ts`) and the
 * domain tests (`test/domain/auth-assembly.ts`).
 *
 * This module is deliberately importable in plain Node: it never imports
 * `next/headers`, `server-only`, React email templates, or reads process.env.
 * Every request-context / infrastructure port (mail, reward, signup guard,
 * request signal, Redis, secret, baseURL, Next plugins, attribution writer)
 * arrives through `AssembleAuthDeps`. The real rules live in
 * `@sunpcm/niu-auth` and the PostgreSQL adapters in `@sunpcm/niu-persistence-pg`;
 * this file only binds the app's `@/lib/db` schema and pricing seat catalog.
 */

import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { BetterAuthPlugin } from "better-auth";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  createAuth,
  type AuthBillingPort,
  type AuthCapabilities,
  type AuthLogger,
  type AuthMailer,
  type AuthPolicyStore,
  type CreateAuthDeps,
  type RateLimitStorage,
  type RequestSignal,
  type RewardHook,
  type SignupGuard,
} from "@sunpcm/niu-auth";
import { createAuthPolicyStore } from "@sunpcm/niu-persistence-pg/auth";
import { createPgCommerceBillingQueries } from "@sunpcm/niu-persistence-pg/commerce";

import { getPlanSeats } from "@/config/pricing";
import { siteConfig } from "@/config/site";
import {
  account,
  invitation,
  member,
  organization,
  session,
  user,
  verification,
} from "@/lib/db/schema";

export type AuthDb = PostgresJsDatabase<Record<string, unknown>>;

/** The Better Auth drizzle adapter for the shared Auth identity tables. */
export function createAuthAdapter(db: AuthDb) {
  return drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user,
      session,
      account,
      verification,
      organization,
      member,
      invitation,
    },
  });
}

/**
 * Bind the PostgreSQL Auth policy store and its billing port in one place.
 * `policyStore` (identity/member/invitation reads + atomic seat compensation)
 * and `billing` (Commerce seat/liveness/history queries) are the two halves
 * `createAuth` needs. Guards only need `policyStore`; the factory needs both.
 */
export function createAuthPolicyStoreBound(
  db: AuthDb,
  seatCatalog: (planId: string | null | undefined) => number = getPlanSeats,
): { policyStore: AuthPolicyStore; billing: AuthBillingPort } {
  const billingQueries = createPgCommerceBillingQueries({ seatCatalog });
  const policyStore = createAuthPolicyStore({ db, billingQueries });
  const billing: AuthBillingPort = {
    getOrgSeatCap: (organizationId) =>
      billingQueries.getOrgSeatCap(db, organizationId),
    hasLivePersonalSubscription: (userId) =>
      billingQueries.hasLivePersonalSubscription(db, userId),
    getOrganizationDeletionBlockers: (organizationId) =>
      billingQueries.getOrganizationDeletionBlockers(db, organizationId),
  };
  return { policyStore, billing };
}

export interface AssembleAuthDeps<
  Caps extends AuthCapabilities = AuthCapabilities,
  Plugins extends readonly BetterAuthPlugin[] = readonly BetterAuthPlugin[],
> {
  db: AuthDb;
  policyStore: AuthPolicyStore;
  /** `null` = billing explicitly disabled (an Auth-only product). */
  billing: AuthBillingPort | null;
  mail: AuthMailer;
  reward?: RewardHook;
  signupGuard: SignupGuard;
  requestSignal: RequestSignal;
  redis: RateLimitStorage | null;
  capabilities: Caps;
  /** Explicit non-empty secret; the core factory rejects an empty value. */
  secret: string;
  baseURL?: string;
  trustedOrigins?: string[];
  rateLimitEnabled?: boolean;
  /** Additional plugins (Next cookies). Kept last by the core factory. */
  plugins?: Plugins;
  trackUserSource?: CreateAuthDeps["trackUserSource"];
  logger?: AuthLogger;
  clock?: () => Date;
}

/**
 * Assemble the production Better Auth application. Only declared capabilities
 * are registered; a declared capability lacking its required config is
 * rejected clearly by `@sunpcm/niu-auth`.
 */
export function assembleAuth<
  Caps extends AuthCapabilities = AuthCapabilities,
  Plugins extends readonly BetterAuthPlugin[] = readonly BetterAuthPlugin[],
>(deps: AssembleAuthDeps<Caps, Plugins>) {
  const {
    db,
    policyStore,
    billing,
    mail,
    reward,
    signupGuard,
    requestSignal,
    redis,
    capabilities,
    secret,
    baseURL,
    trustedOrigins,
    rateLimitEnabled,
    plugins,
    trackUserSource,
    logger,
    clock,
  } = deps;

  const adapter = createAuthAdapter(db);

  return createAuth({
    site: { name: siteConfig.name, url: siteConfig.url },
    adapter,
    policyStore,
    billing,
    mail,
    reward,
    signupGuard,
    redis,
    requestSignal,
    capabilities,
    secret,
    baseURL,
    trustedOrigins,
    rateLimitEnabled,
    plugins,
    trackUserSource,
    logger,
    clock,
  });
}
