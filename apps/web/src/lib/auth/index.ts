/**
 * Production wiring of `lib/auth`. This file holds the server-only boundaries:
 * `next/headers` (cookies), the real Redis client, the real mail transport
 * (React templates) and the real attribution writer are injected here into the
 * pure composition (`../composition/auth`). Business rules live in
 * `@sunpcm/niu-auth` and the PostgreSQL adapters, so production and tests cannot
 * drift apart.
 */

import "server-only";

import { cookies } from "next/headers";

import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { getLogger } from "@/lib/logger";
import { notifySignupGiftWithheld } from "@/lib/discord/notifications";
import { createGrantSignupRewards } from "@/lib/auth/signup-rewards";
import { createAuthMailer } from "@/lib/auth/mail";
import { isSignupEmailBlocked, isSignupIpBlocked } from "@/lib/signup-blocklist";
import {
  buildUserSourceData,
  parseTrackingCookie,
  saveUserSource,
  TRACKING_COOKIE_NAME,
} from "@/lib/tracking/server";
import { isTrackingEnabled } from "@/lib/tracking/shared";
import { siteConfig } from "@/config/site";
import {
  assembleAuth,
  createAuthPolicyStoreBound,
} from "@/composition/auth";
import {
  createNextAuthPlugins,
  createNextRequestSignal,
} from "@sunpcm/niu-next";
import type {
  AuthCapabilities,
  AuthLogger,
  SignupGuard,
} from "@sunpcm/niu-auth";

/**
 * Production capability selection. The always-on capabilities are declared as
 * literal `true` (not widened `boolean`) so `assembleAuth`/`createAuth` keep the
 * admin and organization SDK surface in the emitted `auth` instance. Only the
 * environment-driven capabilities (`social`, `oneTap`, `captcha`) stay dynamic.
 */
type ProductionCapabilities = {
  social?: NonNullable<AuthCapabilities["social"]>;
  oneTap: boolean;
  captcha?: NonNullable<AuthCapabilities["captcha"]>;
  magicLink: true;
  emailOTP: true;
  anonymous: true;
  admin: true;
  organization: true;
  billing: true;
};

function buildCapabilities(): ProductionCapabilities {
  const githubClientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  const social: NonNullable<AuthCapabilities["social"]> = {};
  if (githubClientId || githubClientSecret) {
    social.github = {
      clientId: githubClientId ?? "",
      clientSecret: githubClientSecret ?? "",
    };
  }
  if (googleClientId || googleClientSecret) {
    social.google = {
      clientId: googleClientId ?? "",
      clientSecret: googleClientSecret ?? "",
    };
  }

  return {
    ...(Object.keys(social).length > 0 ? { social } : {}),
    oneTap: !!googleClientId,
    ...(process.env.TURNSTILE_SECRET_KEY
      ? { captcha: { secretKey: process.env.TURNSTILE_SECRET_KEY } }
      : {}),
    magicLink: true,
    emailOTP: true,
    anonymous: true,
    admin: true,
    organization: true,
    billing: true,
  };
}

const signupGuard: SignupGuard = {
  isEmailBlocked: (email) => isSignupEmailBlocked(email, undefined, redis),
  isIpBlocked: (ip) => isSignupIpBlocked(ip, undefined, redis),
};

const trackUserSource = async (user: {
  id: string;
  email: string;
  name: string | null;
}): Promise<void> => {
  if (!(await isTrackingEnabled())) return;
  const cookieStore = await cookies();
  const trackingCookie = cookieStore.get(TRACKING_COOKIE_NAME);
  const clientData = parseTrackingCookie(trackingCookie?.value);
  const sourceData = await buildUserSourceData(
    user.id,
    clientData || undefined,
  );
  await saveUserSource(sourceData);
  cookieStore.delete(TRACKING_COOKIE_NAME);
};

const appLogger = getLogger("auth");
const logger: AuthLogger = {
  warn: (message, context) => appLogger.warn(context ?? {}, message),
  error: (message, context) => appLogger.error(context ?? {}, message),
};

const reward = createGrantSignupRewards({
  redis,
  notifySignupGiftWithheld,
  logger: appLogger,
});

const { policyStore, billing } = createAuthPolicyStoreBound(db);

const trustedOrigins =
  process.env.NODE_ENV === "development"
    ? [siteConfig.url, "http://localhost:3000"]
    : [siteConfig.url];

export const auth = assembleAuth({
  db,
  policyStore,
  billing,
  mail: createAuthMailer(),
  reward,
  signupGuard,
  requestSignal: createNextRequestSignal(),
  redis,
  capabilities: buildCapabilities(),
  secret: process.env.BETTER_AUTH_SECRET ?? "",
  baseURL:
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL || process.env.NEXT_PUBLIC_SITE_URL,
  trustedOrigins,
  rateLimitEnabled:
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_RATE_LIMIT_ENABLED === "true",
  plugins: createNextAuthPlugins(),
  trackUserSource,
  logger,
});

/** Policy store for `lib/auth/server.ts` (fresh-session guards). */
export { policyStore };
