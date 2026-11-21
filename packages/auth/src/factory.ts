import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import {
  admin,
  anonymous,
  captcha,
  emailOTP,
  lastLoginMethod,
  magicLink,
  oneTap,
  type AdminOptions,
  type LastLoginMethodOptions,
} from "better-auth/plugins";
import type { Auth, BetterAuthOptions, BetterAuthPlugin } from "better-auth";

import {
  adminAccessControl,
  adminAccessRoles,
  IMPERSONATION_SESSION_DURATION_SECONDS,
} from "./admin-access.js";
import {
  BANNED_USER_ALLOWED_PATHS,
  BANNED_USER_READ_ONLY_PATHS,
  isBanActive,
} from "./ban-policy.js";
import { ADMIN_DISABLED_PATHS } from "./disabled-paths.js";
import { CLIENT_IP_HEADERS, UNKNOWN_IP } from "./ip.js";
import { createOrganizationPlugin } from "./organization.js";
import type {
  AuthCapabilities,
  AuthLogger,
  AuthMailer,
  AuthSiteInfo,
  CreateAuthDeps,
  SocialProviderConfig,
} from "./types.js";

type OneTapPlugin = ReturnType<typeof oneTap>;
type CaptchaPlugin = ReturnType<typeof captcha>;
type MagicLinkPlugin = ReturnType<typeof magicLink>;
type EmailOTPPlugin = ReturnType<typeof emailOTP>;
type LastLoginMethodPlugin = ReturnType<
  typeof lastLoginMethod<LastLoginMethodOptions>
>;
type AdminPlugin = ReturnType<typeof admin<AdminOptions>>;
type AnonymousPlugin = ReturnType<typeof anonymous>;
type OrganizationPlugin = ReturnType<typeof createOrganizationPlugin>;

type CapabilityPluginTuple<Caps extends AuthCapabilities> = [
  ...(Caps["oneTap"] extends true ? [OneTapPlugin] : []),
  ...(Caps["captcha"] extends { secretKey: string } ? [CaptchaPlugin] : []),
  ...(Caps["magicLink"] extends true ? [MagicLinkPlugin] : []),
  ...(Caps["emailOTP"] extends true ? [EmailOTPPlugin] : []),
  LastLoginMethodPlugin,
  ...(Caps["admin"] extends true ? [AdminPlugin] : []),
  ...(Caps["anonymous"] extends true ? [AnonymousPlugin] : []),
  ...(Caps["organization"] extends true ? [OrganizationPlugin] : []),
];

export type AuthPlugins<
  Caps extends AuthCapabilities = AuthCapabilities,
  Plugins extends readonly BetterAuthPlugin[] = readonly BetterAuthPlugin[],
> = [...CapabilityPluginTuple<Caps>, ...Plugins];

export type AuthOptions<
  Caps extends AuthCapabilities = AuthCapabilities,
  Plugins extends readonly BetterAuthPlugin[] = readonly BetterAuthPlugin[],
> = Omit<BetterAuthOptions, "plugins"> & {
  plugins: AuthPlugins<Caps, Plugins>;
};

export const DEVICE_SIGNAL_COOKIE_NAME = "device_signal";

const noopLogger: AuthLogger = {
  warn() {},
  error() {},
};

/** Snapshot plain config so later signup hooks never see caller-mutated data. */
function snapshotSite(site: AuthSiteInfo): AuthSiteInfo {
  return { name: site.name, url: site.url };
}

function snapshotCapabilities<Caps extends AuthCapabilities>(
  capabilities: Caps,
): Caps {
  const snapshot: AuthCapabilities = { ...capabilities };
  if (capabilities.social) {
    snapshot.social = {
      ...(capabilities.social.github
        ? { github: { ...capabilities.social.github } }
        : {}),
      ...(capabilities.social.google
        ? { google: { ...capabilities.social.google } }
        : {}),
    };
  }
  if (capabilities.captcha) {
    snapshot.captcha = { ...capabilities.captcha };
  }
  return snapshot as Caps;
}

function assertCapabilities(
  capabilities: AuthCapabilities,
  mail: AuthMailer | undefined,
  billing: CreateAuthDeps["billing"],
): void {
  for (const [name, cfg] of Object.entries(capabilities.social ?? {})) {
    if (cfg && (!cfg.clientId || !cfg.clientSecret)) {
      throw new Error(
        `Auth capability "social.${name}" requires clientId and clientSecret.`,
      );
    }
  }
  if (capabilities.oneTap && !capabilities.social?.google?.clientId) {
    throw new Error('Auth capability "oneTap" requires social.google.clientId.');
  }
  if (capabilities.captcha && !capabilities.captcha.secretKey) {
    throw new Error('Auth capability "captcha" requires a secretKey.');
  }
  if (capabilities.magicLink && !mail?.sendMagicLink) {
    throw new Error(
      'Auth capability "magicLink" requires mail.sendMagicLink.',
    );
  }
  if (capabilities.emailOTP && !mail?.sendVerificationOtp) {
    throw new Error(
      'Auth capability "emailOTP" requires mail.sendVerificationOtp.',
    );
  }
  if (capabilities.organization && !billing) {
    throw new Error('Auth capability "organization" requires a billing port.');
  }
  if (capabilities.organization && !mail?.sendOrganizationInvitation) {
    throw new Error(
      'Auth capability "organization" requires mail.sendOrganizationInvitation.',
    );
  }
  if (capabilities.billing && !billing) {
    throw new Error('Auth capability "billing" requires a billing port.');
  }
}

function buildSocialProviders(
  social: AuthCapabilities["social"],
): Record<string, SocialProviderConfig> {
  const providers: Record<string, SocialProviderConfig> = {};
  if (social?.github) providers.github = social.github;
  if (social?.google) providers.google = social.google;
  return providers;
}

export function createAuth<
  Caps extends AuthCapabilities = AuthCapabilities,
  Plugins extends readonly BetterAuthPlugin[] = readonly BetterAuthPlugin[],
>(deps: CreateAuthDeps<Caps, Plugins>): Auth<AuthOptions<Caps, Plugins>> {
  const {
    site,
    adapter,
    policyStore,
    mail,
    reward,
    signupGuard,
    redis,
    requestSignal,
    capabilities,
    secret,
    trustedOrigins,
    rateLimitEnabled,
    plugins,
    trackUserSource,
  } = deps;
  const billing = deps.billing;
  const clock = deps.clock ?? (() => new Date());
  const logger = deps.logger ?? noopLogger;

  if (!secret || secret.trim().length === 0) {
    throw new Error('createAuth requires a non-empty "secret".');
  }

  const siteSnapshot = snapshotSite(site);
  const capabilitiesSnapshot = snapshotCapabilities(capabilities);
  const baseURL = deps.baseURL ?? siteSnapshot.url;

  assertCapabilities(capabilitiesSnapshot, mail, billing);

  const pluginList = [
    ...(capabilitiesSnapshot.oneTap ? [oneTap()] : []),
    ...(capabilitiesSnapshot.captcha
      ? [
          captcha({
            provider: "cloudflare-turnstile",
            secretKey: capabilitiesSnapshot.captcha.secretKey,
          }),
        ]
      : []),
    ...(capabilitiesSnapshot.magicLink
      ? [
          magicLink({
            sendMagicLink: async ({ email, url }) => {
              await mail!.sendMagicLink!({ email, url });
            },
            expiresIn: 60 * 5,
          }),
        ]
      : []),
    ...(capabilitiesSnapshot.emailOTP
      ? [
          emailOTP({
            otpLength: 6,
            expiresIn: 60 * 10,
            sendVerificationOTP: async ({ email, otp, type }) => {
              await mail!.sendVerificationOtp!({ email, otp, type });
            },
          }),
        ]
      : []),
    lastLoginMethod(),
    ...(capabilitiesSnapshot.admin
      ? [
          admin({
            ac: adminAccessControl,
            roles: adminAccessRoles,
            adminRoles: ["admin", "superadmin"],
            impersonationSessionDuration:
              IMPERSONATION_SESSION_DURATION_SECONDS,
          }),
        ]
      : []),
    ...(capabilitiesSnapshot.anonymous ? [anonymous()] : []),
    ...(capabilitiesSnapshot.organization
      ? [
          createOrganizationPlugin({
            policyStore,
            billing: billing!,
            mail: mail!,
            site: siteSnapshot,
            clock,
          }),
        ]
      : []),
    ...(plugins ?? []),
  ];

  return betterAuth({
    appName: siteSnapshot.name,
    baseURL,
    secret,
    disabledPaths: ADMIN_DISABLED_PATHS,
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const path = ctx.path;
        if (BANNED_USER_ALLOWED_PATHS.has(path)) return;
        if (BANNED_USER_READ_ONLY_PATHS.has(path)) return;
        if (ctx.method === "GET") return;

        const token = await ctx.getSignedCookie(
          ctx.context.authCookies.sessionToken.name,
          ctx.context.secret,
        );
        if (!token) return;

        const found = await ctx.context.internalAdapter.findSession(token);
        if (!found?.session?.userId) return;

        const ban = await policyStore.getBanStatus(found.session.userId);
        if (isBanActive(ban.banned, ban.banExpires, clock())) {
          throw new APIError("FORBIDDEN", {
            message: "Your account is banned.",
          });
        }
      }),
    },
    advanced: {
      database: {
        generateId: () => crypto.randomUUID(),
      },
      ipAddress: {
        ipAddressHeaders: [...CLIENT_IP_HEADERS],
      },
    },
    rateLimit: {
      enabled: rateLimitEnabled ?? false,
      window: 60,
      max: 100,
      customRules: {
        "/get-session": false,
        "/sign-in/magic-link": { window: 60, max: 3 },
        "/email-otp/send-verification-otp": { window: 60, max: 3 },
        "/sign-in/email-otp": { window: 60, max: 5 },
      },
      ...(redis && {
        customStorage: {
          get: async (key: string) => {
            const data = await redis.get<{
              key: string;
              count: number;
              lastRequest: number;
            }>(key);
            return data || undefined;
          },
          set: async (
            key: string,
            value: { key: string; count: number; lastRequest: number },
          ) => {
            await redis.set(key, value, { ex: 120 });
          },
        },
      }),
    },
    session: {
      cookieCache: {
        enabled: false,
      },
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google", "github"],
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (deletingUser) => {
          const ownsOrganization = await policyStore.isOrganizationOwner(
            deletingUser.id,
          );
          if (ownsOrganization) {
            throw new APIError("BAD_REQUEST", {
              message:
                "You own a team. Transfer ownership or delete the team before deleting your account.",
            });
          }
          if (capabilitiesSnapshot.billing) {
            const hasLive = await billing!.hasLivePersonalSubscription(
              deletingUser.id,
            );
            if (hasLive) {
              throw new APIError("BAD_REQUEST", {
                message:
                  "You have an active subscription. Cancel it in the billing portal before deleting your account.",
              });
            }
          }
        },
      },
    },
    database: adapter,
    socialProviders: buildSocialProviders(capabilitiesSnapshot.social),
    databaseHooks: {
      user: {
        create: {
          before: async (data) => {
            if (data.email && (await signupGuard.isEmailBlocked(data.email))) {
              throw new APIError("FORBIDDEN", {
                message: "Registration with this email is not allowed.",
              });
            }

            const ip = await requestSignal.getClientIP();
            if (ip !== UNKNOWN_IP && (await signupGuard.isIpBlocked(ip))) {
              throw new APIError("FORBIDDEN", {
                message: "Registration from your network is not allowed.",
              });
            }
            return { data };
          },
          after: async (createdUser) => {
            if (reward) {
              await reward({
                userId: createdUser.id,
                email: createdUser.email,
                ip: await requestSignal.getClientIP(),
                deviceHash: await requestSignal.getCookie(
                  DEVICE_SIGNAL_COOKIE_NAME,
                ),
              });
            }

            if (trackUserSource) {
              try {
                await trackUserSource({
                  id: createdUser.id,
                  email: createdUser.email,
                  name: createdUser.name,
                });
              } catch (error) {
                logger.error("Failed to save user source data", { error });
              }
            }

            if (createdUser.email && mail?.sendWelcome) {
              try {
                const unsubscribeToken = Buffer.from(
                  createdUser.email,
                ).toString("base64");
                const unsubscribeLink = `${siteSnapshot.url}/unsubscribe/newsletter?token=${unsubscribeToken}`;
                await mail.sendWelcome({
                  email: createdUser.email,
                  name: createdUser.name,
                  unsubscribeLink,
                });
              } catch (error) {
                logger.error("Failed to send welcome email", { error });
              }
            }
          },
        },
      },
    },
    trustedOrigins: trustedOrigins ?? [siteSnapshot.url],
    plugins: pluginList as AuthPlugins<Caps, Plugins>,
  });
}

export type AuthInstance<
  Caps extends AuthCapabilities = AuthCapabilities,
  Plugins extends readonly BetterAuthPlugin[] = readonly BetterAuthPlugin[],
> = Auth<AuthOptions<Caps, Plugins>>;
