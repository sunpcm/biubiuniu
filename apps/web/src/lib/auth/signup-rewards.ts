/**
 * Signup reward orchestration. Thin adapter over `@sunpcm/niu-auth`'s
 * `createGrantSignupRewards`: the core owns the fault-tolerant "cluster
 * decision -> welcome gift" order and the "never throw" contract; this file
 * only injects the app's credits config, gift-gate decision, ledger writer,
 * ops notification and logger (mapping the app logger's `(obj, msg)` shape to
 * the core `(message, context)` shape).
 */
import {
  createGrantSignupRewards as createCoreGrantSignupRewards,
  type SignupRewardsInput,
  type AuthLogger,
} from "@sunpcm/niu-auth";
import { creditsConfig } from "@/config/credits";
import { grantSignupBonusCredits } from "@/lib/credits/ledger";
import { decideSignupGift } from "@/lib/signup-gift-gate";
import type { UnifiedRedis } from "@/lib/redis/types";

export type { SignupRewardsInput };

/** Logger shape the legacy callers already pass (matches `@/lib/logger`). */
export interface SignupRewardsLogger {
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface SignupRewardsDeps {
  redis: UnifiedRedis | null;
  notifySignupGiftWithheld: (params: {
    userId: string;
    email: string;
    reason: "ip_cap" | "device_cap";
    ip?: string;
    deviceHash?: string;
    ipCount?: number;
    deviceCount?: number;
  }) => Promise<void>;
  logger: SignupRewardsLogger;
}

function toCoreLogger(logger: SignupRewardsLogger): AuthLogger {
  return {
    warn: (message, context) => logger.warn(context ?? {}, message),
    error: (message, context) => logger.error(context ?? {}, message),
  };
}

export function createGrantSignupRewards(
  deps: SignupRewardsDeps,
): (input: SignupRewardsInput) => Promise<void> {
  const { redis, notifySignupGiftWithheld, logger } = deps;

  return createCoreGrantSignupRewards({
    redis,
    signupBonusCredits: creditsConfig.signupBonusCredits,
    decideSignupGift: (params, redisClient) =>
      decideSignupGift(params, redisClient as UnifiedRedis | null),
    grantWelcomeCredits: async ({ userId, amount, note }) => {
      await grantSignupBonusCredits({ userId, amount, note });
    },
    notifySignupGiftWithheld,
    logger: toCoreLogger(logger),
  });
}
