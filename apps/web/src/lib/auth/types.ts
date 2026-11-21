/**
 * Type boundary for the auth composition. Re-exports the public contracts of
 * `@sunpcm/niu-auth` and keeps the app-local `Db` / `MailSender` aliases that
 * legacy callers reference.
 */
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import type {
  EmailProviderName,
  SendEmailOptions,
  SendEmailResult,
} from "@/lib/mail/types";

export type Db = PostgresJsDatabase<typeof schema>;

export type MailSender = (
  options: SendEmailOptions,
  provider?: EmailProviderName,
) => Promise<SendEmailResult>;

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
} from "@sunpcm/niu-auth";

export type {
  AuthPolicyStore,
  AuthBillingPort,
  BanStatus,
  OrgSeatCap,
  OrganizationDeletionBlockers,
} from "@sunpcm/niu-auth";
