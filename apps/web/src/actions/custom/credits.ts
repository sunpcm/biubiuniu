"use server";

/**
 * [CUSTOM] 积分管理功能
 *
 * TODO: 这些函数之前使用 Supabase Client，需要迁移到 Drizzle ORM。
 * 由于积分系统依赖自定义的 usage 表和 RPC functions，
 * 暂时使用 Drizzle raw SQL 进行基本查询。
 * 高级操作（add/set/deduct via RPC）暂时禁用，等数据库 RPC 迁移后再启用。
 */

import { actionResponse } from "@/lib/action-response";
import { getErrorMessage } from "@/lib/error-utils";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface UserCredits {
  oneTimeCreditsBalance: number;
  subscriptionCreditsBalance: number;
  totalCredits: number;
}

export interface GetUserCreditsResult {
  success: boolean;
  data?: UserCredits;
  error?: string;
}

export interface AdjustCreditsParams {
  userId: string;
  oneTimeCredits?: number;
  subscriptionCredits?: number;
  operation: "add" | "set" | "deduct";
  notes: string;
}

/**
 * 获取用户积分信息
 */
export async function getUserCredits(userId: string): Promise<GetUserCreditsResult> {
  if (!userId) {
    return actionResponse.error("User ID is required.");
  }

  try {
    const result = await db.execute(
      sql`SELECT one_time_credits_balance, subscription_credits_balance FROM usage WHERE user_id = ${userId} LIMIT 1`,
    );

    const usage = (
      result as unknown as Array<{
        one_time_credits_balance: number;
        subscription_credits_balance: number;
      }>
    )?.[0];

    const oneTimeBalance = usage?.one_time_credits_balance || 0;
    const subscriptionBalance = usage?.subscription_credits_balance || 0;

    return actionResponse.success({
      oneTimeCreditsBalance: oneTimeBalance,
      subscriptionCreditsBalance: subscriptionBalance,
      totalCredits: oneTimeBalance + subscriptionBalance,
    });
  } catch (error) {
    console.error("Error in getUserCredits:", error);
    return actionResponse.error(getErrorMessage(error));
  }
}

/**
 * 调整用户积分
 * TODO: 需要将 Supabase RPC (grant_one_time_credits_and_log 等) 迁移为
 * Drizzle 事务或 PostgreSQL 函数调用。暂时返回错误提示。
 */
export async function adjustUserCredits({
  userId,
  oneTimeCredits = 0,
  subscriptionCredits = 0,
  operation,
  notes,
}: AdjustCreditsParams) {
  if (!userId) {
    return actionResponse.error("User ID is required.");
  }

  if (!notes.trim()) {
    return actionResponse.error("Notes are required for credit adjustments.");
  }

  try {
    // Verify user exists via Drizzle
    const userResult = await db.execute(
      sql`SELECT id, email FROM "user" WHERE id = ${userId} LIMIT 1`,
    );

    if (!(userResult as unknown as Array<unknown>)?.length) {
      return actionResponse.error("User not found.");
    }

    // TODO: Migrate Supabase RPCs to Drizzle raw SQL or PostgreSQL functions
    // For now, use raw SQL for basic operations
    switch (operation) {
      case "add":
        if (oneTimeCredits > 0) {
          await db.execute(
            sql`UPDATE usage SET one_time_credits_balance = one_time_credits_balance + ${oneTimeCredits} WHERE user_id = ${userId}`,
          );
        }
        if (subscriptionCredits > 0) {
          await db.execute(
            sql`UPDATE usage SET subscription_credits_balance = subscription_credits_balance + ${subscriptionCredits} WHERE user_id = ${userId}`,
          );
        }
        break;

      case "set":
        if (oneTimeCredits !== undefined) {
          await db.execute(
            sql`UPDATE usage SET one_time_credits_balance = ${oneTimeCredits} WHERE user_id = ${userId}`,
          );
        }
        if (subscriptionCredits !== undefined) {
          await db.execute(
            sql`UPDATE usage SET subscription_credits_balance = ${subscriptionCredits} WHERE user_id = ${userId}`,
          );
        }
        break;

      case "deduct":
        if (oneTimeCredits > 0) {
          await db.execute(
            sql`UPDATE usage SET one_time_credits_balance = GREATEST(0, one_time_credits_balance - ${oneTimeCredits}) WHERE user_id = ${userId}`,
          );
        }
        if (subscriptionCredits > 0) {
          await db.execute(
            sql`UPDATE usage SET subscription_credits_balance = GREATEST(0, subscription_credits_balance - ${subscriptionCredits}) WHERE user_id = ${userId}`,
          );
        }
        break;

      default:
        return actionResponse.error("Invalid operation type.");
    }

    return actionResponse.success({
      message: "Credits adjusted successfully.",
    });
  } catch (error) {
    console.error("Error in adjustUserCredits:", error);
    return actionResponse.error(getErrorMessage(error));
  }
}
