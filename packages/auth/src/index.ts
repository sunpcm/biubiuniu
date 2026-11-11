export { createAuth, DEVICE_SIGNAL_COOKIE_NAME } from "./factory.js";
export type { AuthInstance, AuthOptions, AuthPlugins } from "./factory.js";

export { isBanActive, BANNED_USER_ALLOWED_PATHS, BANNED_USER_READ_ONLY_PATHS } from "./ban-policy.js";
export { isAdminUserRole, isSuperAdminUserRole } from "./permissions.js";
export { ADMIN_DISABLED_PATHS } from "./disabled-paths.js";
export {
  adminAccessControl,
  adminAccessRoles,
  IMPERSONATION_SESSION_DURATION_SECONDS,
} from "./admin-access.js";
export { CLIENT_IP_HEADERS, UNKNOWN_IP, pickClientIP } from "./ip.js";
export { createOrganizationPlugin } from "./organization.js";
export type { OrganizationPluginDeps } from "./organization.js";
export { createServerGuards } from "./guards.js";
export type {
  GuardSessionShape,
  GuardUserShape,
  SessionAuthClient,
  ServerGuardsDeps,
  WorkspaceContext,
} from "./guards.js";
export { createGrantSignupRewards } from "./signup-rewards.js";
export type {
  SignupGiftDecision,
  SignupRewardsDeps,
} from "./signup-rewards.js";

export { createStaticBillingPort } from "./policy-store.js";
export type {
  AuthPolicyStore,
  AuthBillingPort,
  BanStatus,
  OrgSeatCap,
  OrganizationDeletionBlockers,
} from "./policy-store.js";

export type {
  AuthDatabaseAdapter,
  AuthSiteInfo,
  RateLimitStorage,
  AuthLogger,
  AuthMailer,
  RequestSignal,
  SignupGuard,
  SocialProviderConfig,
  AuthCapabilities,
  SignupRewardsInput,
  RewardHook,
  CreateAuthDeps,
} from "./types.js";
