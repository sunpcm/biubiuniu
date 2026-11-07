/**
 * Signup reward orchestration. Two fault-tolerant steps in fixed order:
 *   1. identity-cluster decision (injected `decideSignupGift`, app-owned Redis),
 *   2. welcome gift (injected `grantWelcomeCredits`, the Commerce ledger).
 * Nothing here throws: an undelivered reward is an ops issue, never a reason to
 * block the signup. Missing signals or a failed decision "let through".
 */

import type { AuthLogger, SignupRewardsInput } from "./types.js";

export interface SignupGiftDecision {
  grant: boolean;
  reason?: "ip_cap" | "device_cap";
  ip?: string;
  deviceHash?: string;
  ipCount?: number;
  deviceCount?: number;
}

export interface SignupRewardsDeps {
  redis: unknown;
  signupBonusCredits: number;
  decideSignupGift: (
    params: { ip?: string; deviceHash?: string },
    redis: unknown,
  ) => Promise<SignupGiftDecision>;
  grantWelcomeCredits: (params: {
    userId: string;
    amount: number;
    note?: string;
  }) => Promise<void>;
  notifySignupGiftWithheld: (params: {
    userId: string;
    email: string;
    reason: "ip_cap" | "device_cap";
    ip?: string;
    deviceHash?: string;
    ipCount?: number;
    deviceCount?: number;
  }) => Promise<void>;
  logger: AuthLogger;
}

export function createGrantSignupRewards(
  deps: SignupRewardsDeps,
): (input: SignupRewardsInput) => Promise<void> {
  const {
    redis,
    signupBonusCredits,
    decideSignupGift,
    grantWelcomeCredits,
    notifySignupGiftWithheld,
    logger,
  } = deps;

  return async function grantSignupRewards(
    input: SignupRewardsInput,
  ): Promise<void> {
    const { userId, email, ip, deviceHash } = input;
    if (signupBonusCredits <= 0) return;

    let rewardAllowed = true;
    try {
      const decision = await decideSignupGift({ ip, deviceHash }, redis);
      rewardAllowed = decision.grant;
      if (!decision.grant) {
        logger.warn("signup_gift_withheld", {
          userId,
          email,
          ...decision,
        });
        void notifySignupGiftWithheld({
          userId,
          email,
          reason: decision.reason ?? "ip_cap",
          ip: decision.ip,
          deviceHash: decision.deviceHash,
          ipCount: decision.ipCount,
          deviceCount: decision.deviceCount,
        });
      }
    } catch (error) {
      logger.error("signup_gift_gate_failed", { userId, error });
      rewardAllowed = true;
    }
    if (!rewardAllowed) return;

    try {
      await grantWelcomeCredits({
        userId,
        amount: signupBonusCredits,
        note: "Welcome bonus",
      });
    } catch (error) {
      logger.error("signup_bonus_grant_failed", { userId, error });
    }
  };
}
