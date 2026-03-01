/**
 * Credit Management System
 *
 * This module handles all credit-related operations for the payment system.
 * It is provider-agnostic and used by all payment providers (Stripe, Creem, etc.)
 *
 * Key Operations:
 * - Upgrade one-time credits (one-time purchases)
 * - Upgrade subscription credits (monthly/yearly subscriptions)
 * - Revoke one-time credits (refunds)
 * - Revoke subscription credits (subscription refunds)
 * - Revoke remaining credits (subscription cancellation/expiration)
 *
 * 这个模块处理支付系统的所有积分相关操作。
 * 它是提供商无关的，由所有支付提供商（Stripe、Creem 等）使用。
 *
 * このモジュールは、支払いシステムのすべてのクレジット関連操作を処理します。
 * プロバイダーに依存せず、すべての支払いプロバイダー（Stripe、Creem など）で使用されます。
 */

import { db } from "@niu/db";
import {
  creditLogs as creditLogsSchema,
  PaymentProvider,
  pricingPlans as pricingPlansSchema,
  usage as usageSchema,
} from "@niu/db/schema";
import { isMonthlyInterval, isYearlyInterval } from "@/lib/payments/provider-utils";
import type { Order } from "@/lib/payments/types";
import { eq, sql } from "drizzle-orm";

// ============================================================================
// One-Time Credit Operations
// ============================================================================

/**
 * Upgrades one-time credits for a user based on their plan purchase.
 *
 * 根据用户购买的计划为用户升级一次性积分。
 *
 * ユーザーのプラン購入に基づいて、ユーザーのワンタイムクレジットをアップグレードします。
 *
 * @param userId - The user's ID
 * @param planId - The plan's ID
 * @param orderId - The order's ID
 */
export async function upgradeOneTimeCredits(userId: string, planId: string, orderId: string) {
  // --- TODO: [custom] Upgrade the user's benefits ---
  /**
   * Complete the user's benefit upgrade based on your business logic.
   * We recommend defining benefits in the `benefitsJsonb` field within your pricing plans (accessible in the dashboard at /dashboard/prices). This code upgrades the user's benefits based on those defined benefits.
   * The following code provides an example using `oneTimeCredits`.  Modify the code below according to your specific business logic if you need to upgrade other benefits.
   *
   * 根据你的业务逻辑，为用户完成权益升级。
   * 我们建议在定价方案的 `benefitsJsonb` 字段中（可在仪表板的 /dashboard/prices 访问）定义权益。此代码会根据定义的权益，为用户完成权益升级。
   * 以下代码以 `oneTimeCredits` 为例。如果你需要升级其他权益，请根据你的具体业务逻辑修改以下代码。
   *
   * お客様のビジネスロジックに基づいて、ユーザーの特典アップグレードを完了させてください。
   * 特典は、料金プランの `benefitsJsonb` フィールド（ダッシュボードの /dashboard/prices でアクセス可能）で定義することをお勧めします。このコードは、定義された特典に基づいて、ユーザーの特典をアップグレードします。
   * 以下のコードは、`oneTimeCredits` を使用した例です。他の特典をアップグレードする必要がある場合は、お客様のビジネスロジックに従って、以下のコードを修正してください。
   */
  const planDataResults = await db
    .select({ benefitsJsonb: pricingPlansSchema.benefitsJsonb })
    .from(pricingPlansSchema)
    .where(eq(pricingPlansSchema.id, planId))
    .limit(1);
  const planData = planDataResults[0];

  if (!planData) {
    throw new Error(`Could not fetch plan benefits for ${planId}`);
  }

  const creditsToGrant = (planData.benefitsJsonb as any)?.oneTimeCredits || 0;

  if (creditsToGrant && creditsToGrant > 0) {
    let attempts = 0;
    const maxAttempts = 3;
    let lastError: any = null;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        await db.transaction(async (tx) => {
          const updatedUsage = await tx
            .insert(usageSchema)
            .values({
              userId: userId,
              oneTimeCreditsBalance: creditsToGrant,
            })
            .onConflictDoUpdate({
              target: usageSchema.userId,
              set: {
                oneTimeCreditsBalance: sql`${usageSchema.oneTimeCreditsBalance} + ${creditsToGrant}`,
              },
            })
            .returning({
              oneTimeBalanceAfter: usageSchema.oneTimeCreditsBalance,
              subscriptionBalanceAfter: usageSchema.subscriptionCreditsBalance,
            });

          const balances = updatedUsage[0];
          if (!balances) {
            throw new Error("Failed to update usage and get new balances.");
          }

          await tx.insert(creditLogsSchema).values({
            userId: userId,
            amount: creditsToGrant,
            oneTimeBalanceAfter: balances.oneTimeBalanceAfter,
            subscriptionBalanceAfter: balances.subscriptionBalanceAfter,
            type: "one_time_purchase",
            notes: "One-time credit purchase",
            relatedOrderId: orderId,
          });
        });
        console.log(
          `Successfully granted one-time credits for user ${userId} on attempt ${attempts}.`,
        );
        return; // Success, exit the function
      } catch (error) {
        lastError = error;
        console.warn(
          `Attempt ${attempts} failed for grant one-time credits and log for user ${userId}. Retrying in ${attempts}s...`,
          (lastError as Error).message,
        );
        if (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, attempts * 1000));
        }
      }
    }

    if (lastError) {
      console.error(
        `Error updating usage (one-time credits, userId: ${userId}, creditsToGrant: ${creditsToGrant}) after ${maxAttempts} attempts:`,
        lastError,
      );
      throw lastError;
    }
  } else {
    console.log(
      `No one-time credits defined or amount is zero for plan ${planId}. Skipping credit grant.`,
    );
  }
  // --- End: [custom] Upgrade the user's benefits ---
}

/**
 * Revokes one-time credits for a refunded order.
 *
 * 为退款订单撤销一次性积分。
 *
 * 返金された注文のワンタイムクレジットを取り消します。
 *
 * @param refundAmountCents - The refund amount in cents
 * @param originalOrder - The original order being refunded
 * @param refundOrderId - The refund order's ID
 */
export async function revokeOneTimeCredits(
  refundAmountCents: number,
  originalOrder: Order,
  refundOrderId: string,
) {
  // --- TODO: [custom] Revoke the user's one time purchase benefits ---
  /**
   * Complete the user's benefit revoke based on your business logic.
   * We recommend defining benefits in the `benefitsJsonb` field within your pricing plans (accessible in the dashboard at /dashboard/prices). This code revokes the user's benefits based on those defined benefits.
   * The following code provides examples using `oneTimeCredits`.  If you need to revoke other benefits, please modify the code below based on your specific business logic.
   *
   * 根据你的业务逻辑，取消退款用户的付费权益。
   * 我们建议在定价方案的 `benefitsJsonb` 字段中（可在仪表板的 /dashboard/prices 访问）定义权益。此代码会根据定义的权益，取消退款用户的付费权益。
   * 以下代码以 `oneTimeCredits` 为例。如果你需要取消其他权益，请根据你的具体业务逻辑修改以下代码。
   *
   * お客様のビジネスロジックに基づいて、ユーザーの特典を取消してください。
   * 特典は、料金プランの `benefitsJsonb` フィールド（ダッシュボードの /dashboard/prices でアクセス可能）で定義することをお勧めします。このコードは、定義された特典に基づいて、ユーザーの特典を取消します。
   * 以下のコードは、`oneTimeCredits` を使用した例です。他の特典を取消する必要がある場合は、お客様のビジネスロジックに従って、以下のコードを修正してください。
   */
  const planId = originalOrder.planId as string;
  const userId = originalOrder.userId as string;

  const isFullRefund =
    refundAmountCents === Math.round(parseFloat(originalOrder.amountTotal!) * 100);

  if (isFullRefund) {
    const planDataResults = await db
      .select({ benefitsJsonb: pricingPlansSchema.benefitsJsonb })
      .from(pricingPlansSchema)
      .where(eq(pricingPlansSchema.id, planId))
      .limit(1);
    const planData = planDataResults[0];

    if (!planData) {
      console.error(
        `Error fetching plan benefits for planId ${planId} during refund ${refundOrderId}:`,
      );
    } else {
      let oneTimeToRevoke = 0;
      const benefits = planData.benefitsJsonb as any;

      if (benefits?.oneTimeCredits > 0) {
        oneTimeToRevoke = benefits.oneTimeCredits;
      }

      if (oneTimeToRevoke > 0) {
        try {
          await db.transaction(async (tx) => {
            const usageResults = await tx
              .select()
              .from(usageSchema)
              .where(eq(usageSchema.userId, userId))
              .for("update");
            const usage = usageResults[0];

            if (!usage) {
              return;
            }

            const newOneTimeBalance = Math.max(0, usage.oneTimeCreditsBalance - oneTimeToRevoke);
            const amountRevoked = usage.oneTimeCreditsBalance - newOneTimeBalance;

            if (amountRevoked > 0) {
              await tx
                .update(usageSchema)
                .set({ oneTimeCreditsBalance: newOneTimeBalance })
                .where(eq(usageSchema.userId, userId));

              await tx.insert(creditLogsSchema).values({
                userId,
                amount: -amountRevoked,
                oneTimeBalanceAfter: newOneTimeBalance,
                subscriptionBalanceAfter: usage.subscriptionCreditsBalance,
                type: "refund_revoke",
                notes: `Full refund for order ${originalOrder.id}.`,
                relatedOrderId: originalOrder.id,
              });
            }
          });
          console.log(
            `Successfully revoked credits for user ${userId} related to refund ${refundOrderId}.`,
          );
        } catch (revokeError) {
          console.error(
            `Error calling revoke credits and log for user ${userId}, refund ${refundOrderId}:`,
            revokeError,
          );
        }
      } else {
        console.log(
          `No credits defined to revoke for plan ${planId}, order type ${originalOrder.orderType} on refund ${refundOrderId}.`,
        );
      }
    }
  } else {
    console.log(
      `Refund ${refundOrderId} is not a full refund. Skipping credit revocation. Refunded: ${refundAmountCents}, Original Total: ${parseFloat(originalOrder.amountTotal!) * 100}`,
    );
  }
  // --- End: [custom] Revoke the user's one time purchase benefits ---
}

// ============================================================================
// Subscription Credit Operations
// ============================================================================

/**
 * Upgrades subscription credits for a user based on their subscription plan.
 * Handles both monthly and yearly subscription intervals.
 *
 * 根据用户的订阅计划为用户升级订阅积分。
 * 处理月度和年度订阅间隔。
 *
 * ユーザーのサブスクリプションプランに基づいて、ユーザーのサブスクリプションクレジットをアップグレードします。
 * 月次および年次のサブスクリプション間隔を処理します。
 *
 * @param userId - The user's ID
 * @param planId - The plan's ID
 * @param orderId - The order's ID
 * @param currentPeriodStart - The subscription period start time (13-digit timestamp)
 */
export async function upgradeSubscriptionCredits(
  userId: string,
  planId: string,
  orderId: string,
  currentPeriodStart: number,
) {
  // --- TODO: [custom] Upgrade the user's benefits ---
  /**
   * Complete the user's benefit upgrade based on your business logic.
   * We recommend defining benefits in the `benefitsJsonb` field within your pricing plans (accessible in the dashboard at /dashboard/prices). This code upgrades the user's benefits based on those defined benefits.
   * The following code provides an example using `monthlyCredits`.  Modify the code below according to your specific business logic if you need to upgrade other benefits.
   *
   * 根据你的业务逻辑，为用户完成权益升级。
   * 我们建议在定价方案的 `benefitsJsonb` 字段中（可在仪表板的 /dashboard/prices 访问）定义权益。此代码会根据定义的权益，为用户完成权益升级。
   * 以下代码以 `monthlyCredits` 为例。如果你需要升级其他权益，请根据你的具体业务逻辑修改以下代码。
   *
   * お客様のビジネスロジックに基づいて、ユーザーの特典アップグレードを完了させてください。
   * 特典は、料金プランの `benefitsJsonb` フィールド（ダッシュボードの /dashboard/prices でアクセス可能）で定義することをお勧めします。このコードは、定義された特典に基づいて、ユーザーの特典をアップグレードします。
   * 以下のコードは、`monthlyCredits` を使用した例です。他の特典をアップグレードする必要がある場合は、お客様のビジネスロジックに従って、以下のコードを修正してください。
   */
  try {
    const planDataResults = await db
      .select({
        recurringInterval: pricingPlansSchema.recurringInterval,
        benefitsJsonb: pricingPlansSchema.benefitsJsonb,
      })
      .from(pricingPlansSchema)
      .where(eq(pricingPlansSchema.id, planId))
      .limit(1);
    const planData = planDataResults[0];

    if (!planData) {
      console.error(
        `Error fetching plan benefits for planId ${planId} during order ${orderId} processing`,
      );
      throw new Error(`Could not fetch plan benefits for ${planId}`);
    }

    const benefits = planData.benefitsJsonb as any;
    const recurringInterval = planData.recurringInterval;

    const creditsToGrant = benefits?.monthlyCredits || 0;

    if (isMonthlyInterval(recurringInterval) && creditsToGrant) {
      let attempts = 0;
      const maxAttempts = 3;
      let lastError: any = null;

      while (attempts < maxAttempts) {
        attempts++;
        try {
          await db.transaction(async (tx) => {
            const monthlyDetails = {
              monthlyAllocationDetails: {
                monthlyCredits: creditsToGrant,
                relatedOrderId: orderId,
              },
            };

            const updatedUsage = await tx
              .insert(usageSchema)
              .values({
                userId: userId,
                subscriptionCreditsBalance: creditsToGrant,
                balanceJsonb: monthlyDetails,
              })
              .onConflictDoUpdate({
                target: usageSchema.userId,
                set: {
                  subscriptionCreditsBalance: creditsToGrant,
                  balanceJsonb: sql`coalesce(${usageSchema.balanceJsonb}, '{}'::jsonb) - 'monthlyAllocationDetails' || ${JSON.stringify(monthlyDetails)}::jsonb`,
                },
              })
              .returning({
                oneTimeBalanceAfter: usageSchema.oneTimeCreditsBalance,
                subscriptionBalanceAfter: usageSchema.subscriptionCreditsBalance,
              });

            const balances = updatedUsage[0];
            if (!balances) {
              throw new Error("Failed to update usage for monthly subscription");
            }

            await tx.insert(creditLogsSchema).values({
              userId: userId,
              amount: creditsToGrant,
              oneTimeBalanceAfter: balances.oneTimeBalanceAfter,
              subscriptionBalanceAfter: balances.subscriptionBalanceAfter,
              type: "subscription_grant",
              notes: "Subscription credits granted/reset",
              relatedOrderId: orderId,
            });
          });
          console.log(
            `Successfully granted subscription credits for user ${userId} on attempt ${attempts}.`,
          );
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          console.warn(
            `Attempt ${attempts} failed for grant subscription credits and log for user ${userId}. Retrying in ${attempts}s...`,
            (lastError as Error).message,
          );
          if (attempts < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, attempts * 1000));
          }
        }
      }

      if (lastError) {
        console.error(
          `Error setting subscription credits for user ${userId} (order ${orderId}) after ${maxAttempts} attempts:`,
          lastError,
        );
        throw lastError;
      }
      return;
    }

    if (isYearlyInterval(recurringInterval) && benefits?.totalMonths && benefits?.monthlyCredits) {
      let attempts = 0;
      const maxAttempts = 3;
      let lastError: any = null;

      while (attempts < maxAttempts) {
        attempts++;
        try {
          await db.transaction(async (tx) => {
            const startDate = new Date(currentPeriodStart); // currentPeriodStart is a 13 digits timestamp
            const nextCreditDate = new Date(
              startDate.getFullYear(),
              startDate.getMonth() + 1,
              startDate.getDate(),
            );

            const yearlyDetails = {
              yearlyAllocationDetails: {
                remainingMonths: benefits.totalMonths - 1,
                nextCreditDate: nextCreditDate,
                monthlyCredits: benefits.monthlyCredits,
                lastAllocatedMonth: `${startDate.getFullYear()}-${(startDate.getMonth() + 1).toString().padStart(2, "0")}`,
                relatedOrderId: orderId,
              },
            };

            const updatedUsage = await tx
              .insert(usageSchema)
              .values({
                userId: userId,
                subscriptionCreditsBalance: benefits.monthlyCredits,
                balanceJsonb: yearlyDetails,
              })
              .onConflictDoUpdate({
                target: usageSchema.userId,
                set: {
                  subscriptionCreditsBalance: benefits.monthlyCredits,
                  balanceJsonb: sql`coalesce(${usageSchema.balanceJsonb}, '{}'::jsonb) - 'yearlyAllocationDetails' || ${JSON.stringify(yearlyDetails)}::jsonb`,
                },
              })
              .returning({
                oneTimeBalanceAfter: usageSchema.oneTimeCreditsBalance,
                subscriptionBalanceAfter: usageSchema.subscriptionCreditsBalance,
              });

            const balances = updatedUsage[0];
            if (!balances) {
              throw new Error("Failed to update usage for yearly subscription");
            }

            await tx.insert(creditLogsSchema).values({
              userId: userId,
              amount: benefits.monthlyCredits,
              oneTimeBalanceAfter: balances.oneTimeBalanceAfter,
              subscriptionBalanceAfter: balances.subscriptionBalanceAfter,
              type: "subscription_grant",
              notes: "Yearly plan initial credits granted",
              relatedOrderId: orderId,
            });
          });
          console.log(
            `Successfully initialized yearly allocation for user ${userId} on attempt ${attempts}.`,
          );
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          console.warn(
            `Attempt ${attempts} failed for initialize or reset yearly allocation for user ${userId}. Retrying in ${attempts}s...`,
            (lastError as Error).message,
          );
          if (attempts < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, attempts * 1000));
          }
        }
      }

      if (lastError) {
        console.error(
          `Failed to initialize yearly allocation for user ${userId} after ${maxAttempts} attempts:`,
          lastError,
        );
        throw lastError;
      }
      return;
    }
  } catch (creditError) {
    console.error(`Error processing credits for user ${userId} (order ${orderId}):`, creditError);
    throw creditError;
  }
  // --- End: [custom] Upgrade the user's benefits ---
}

/**
 * Revokes subscription credits for a refunded subscription order.
 *
 * 为退款的订阅订单撤销订阅积分。
 *
 * 返金されたサブスクリプション注文のサブスクリプションクレジットを取り消します。
 *
 * @param originalOrder - The original subscription order being refunded
 */
export async function revokeSubscriptionCredits(originalOrder: Order) {
  // --- TODO: [custom] Revoke the user's subscription benefits ---
  /**
   * Complete the user's subscription benefit revocation based on your business logic.
   *
   * 根据你的业务逻辑，取消用户的订阅权益。
   *
   * お客様のビジネスロジックに基づいて、ユーザーのサブスクリプション特典を取消してください。
   */
  const planId = originalOrder.planId as string;
  const userId = originalOrder.userId as string;
  const subscriptionId = originalOrder.subscriptionId as string;

  try {
    const ctx = await getSubscriptionRevokeContext(planId, userId);
    if (!ctx) {
      return;
    }

    if (ctx.subscriptionToRevoke > 0) {
      await applySubscriptionCreditsRevocation({
        userId,
        amountToRevoke: ctx.subscriptionToRevoke,
        clearMonthly: ctx.clearMonthly,
        clearYearly: ctx.clearYearly,
        logType: "refund_revoke",
        notes: `Full refund for subscription order ${originalOrder.id}.`,
        relatedOrderId: originalOrder.id,
      });
      console.log(
        `Successfully revoked subscription credits for user ${userId} related to subscription ${subscriptionId} refund.`,
      );
    }
  } catch (error) {
    console.error(
      `Error during revokeSubscriptionCredits for user ${userId}, subscription ${subscriptionId}:`,
      error,
    );
  }
  // --- End: [custom] Revoke the user's subscription benefits ---
}

/**
 * Revokes remaining subscription credits when a subscription ends.
 *
 * 当订阅结束时撤销剩余的订阅积分。
 *
 * サブスクリプションが終了したときに、残りのサブスクリプションクレジットを取り消します。
 *
 * @param provider - The payment provider
 * @param subscriptionId - The subscription ID
 * @param userId - The user's ID
 * @param metadata - Additional metadata
 */
export async function revokeRemainingSubscriptionCreditsOnEnd(
  provider: PaymentProvider,
  subscriptionId: string,
  userId: string,
  _metadata: any,
) {
  try {
    const usageRows = await db
      .select({ subscriptionCreditsBalance: usageSchema.subscriptionCreditsBalance })
      .from(usageSchema)
      .where(eq(usageSchema.userId, userId))
      .limit(1);
    const amountToRevoke = usageRows[0]?.subscriptionCreditsBalance ?? 0;

    if (amountToRevoke > 0) {
      await applySubscriptionCreditsRevocation({
        userId,
        amountToRevoke,
        clearMonthly: true,
        clearYearly: true,
        logType: "subscription_ended_revoke",
        notes: `${provider} subscription ${subscriptionId} ended; remaining credits revoked.`,
        relatedOrderId: null,
      });
    }

    console.log(
      `Revoked remaining subscription credits on end for subscription ${subscriptionId}, user ${userId}`,
    );
  } catch (error) {
    console.error(`Error revoking remaining credits for subscription ${subscriptionId}:`, error);
  }
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

/**
 * Gets the context for revoking subscription credits based on plan and usage data.
 *
 * 根据计划和用量数据获取撤销订阅积分的上下文。
 *
 * プランと使用量データに基づいて、サブスクリプションクレジットを取り消すためのコンテキストを取得します。
 */
async function getSubscriptionRevokeContext(planId: string, userId: string) {
  const planDataResults = await db
    .select({ recurringInterval: pricingPlansSchema.recurringInterval })
    .from(pricingPlansSchema)
    .where(eq(pricingPlansSchema.id, planId))
    .limit(1);
  const planData = planDataResults[0];

  if (!planData) {
    console.error(
      `Error fetching plan benefits for planId ${planId} while computing revoke context`,
    );
    return null;
  }

  const usageDataResults = await db
    .select({ balanceJsonb: usageSchema.balanceJsonb })
    .from(usageSchema)
    .where(eq(usageSchema.userId, userId))
    .limit(1);
  const usageData = usageDataResults[0];

  if (!usageData) {
    console.error(`Error fetching usage data for user ${userId} while computing revoke context`);
    return {
      recurringInterval: planData.recurringInterval,
      subscriptionToRevoke: 0,
      clearMonthly: false,
      clearYearly: false,
    };
  }

  let subscriptionToRevoke = 0;
  let clearYearly = false;
  let clearMonthly = false;

  if (isYearlyInterval(planData.recurringInterval)) {
    const yearlyDetails = (usageData.balanceJsonb as any)?.yearlyAllocationDetails;
    subscriptionToRevoke = yearlyDetails?.monthlyCredits || 0;
    clearYearly = true;
  } else if (isMonthlyInterval(planData.recurringInterval)) {
    const monthlyDetails = (usageData.balanceJsonb as any)?.monthlyAllocationDetails;
    subscriptionToRevoke = monthlyDetails?.monthlyCredits || 0;
    clearMonthly = true;
  }

  return {
    recurringInterval: planData.recurringInterval,
    subscriptionToRevoke,
    clearMonthly,
    clearYearly,
  };
}

/**
 * Applies subscription credits revocation to the user's account.
 *
 * 将订阅积分撤销应用到用户账户。
 *
 * ユーザーアカウントにサブスクリプションクレジットの取り消しを適用します。
 */
async function applySubscriptionCreditsRevocation(params: {
  userId: string;
  amountToRevoke: number;
  clearMonthly?: boolean;
  clearYearly?: boolean;
  logType: string;
  notes: string;
  relatedOrderId?: string | null;
}) {
  const { userId, amountToRevoke, clearMonthly, clearYearly, logType, notes, relatedOrderId } =
    params;

  if (!amountToRevoke || amountToRevoke <= 0) {
    return;
  }

  await db.transaction(async (tx) => {
    const usageResults = await tx
      .select()
      .from(usageSchema)
      .where(eq(usageSchema.userId, userId))
      .for("update");
    const usage = usageResults[0];
    if (!usage) {
      return;
    }

    const newSubBalance = Math.max(0, usage.subscriptionCreditsBalance - amountToRevoke);
    const amountRevoked = usage.subscriptionCreditsBalance - newSubBalance;

    const newBalanceJsonb = usage.balanceJsonb as any;
    if (clearYearly) {
      delete newBalanceJsonb?.yearlyAllocationDetails;
    }
    if (clearMonthly) {
      delete newBalanceJsonb?.monthlyAllocationDetails;
    }

    if (amountRevoked > 0) {
      await tx
        .update(usageSchema)
        .set({
          subscriptionCreditsBalance: newSubBalance,
          balanceJsonb: newBalanceJsonb,
        })
        .where(eq(usageSchema.userId, userId));

      await tx.insert(creditLogsSchema).values({
        userId,
        amount: -amountRevoked,
        oneTimeBalanceAfter: usage.oneTimeCreditsBalance,
        subscriptionBalanceAfter: newSubBalance,
        type: logType,
        notes,
        relatedOrderId: relatedOrderId ?? null,
      });
    }
  });
}
