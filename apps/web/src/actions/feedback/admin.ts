"use server";

/**
 * [INPUT]: Depends on @/lib/db for Drizzle client, @/lib/db/schema for feedback/feedbackReplies/user tables,
 *          @/lib/auth/server for isAdmin/isSuperAdmin/getSession, @/lib/action-response for ActionResult,
 *          @/constants/feedback for FEEDBACK_LIMITS, @/types/admin/feedback for FeedbackWithUser/FeedbackUserSummary
 * [OUTPUT]: Exports getAllFeedback, getFeedbackDetail, updateFeedbackStatus, updateFeedbackPriority,
 *           addAdminReply, deleteFeedback server actions + their result types
 * [POS]: Admin-facing feedback management actions, consumed by admin feedback pages
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import {
  FEEDBACK_LIMITS,
  FEEDBACK_PRIORITIES,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
} from "@/constants/feedback";
import type { ActionResult } from "@/lib/action-response";
import { actionResponse } from "@/lib/action-response";
import { getSession, isAdmin, isSuperAdmin } from "@/lib/auth/server";
import { db } from "@/lib/db";
import type { FeedbackReplyRow, FeedbackRow } from "@/lib/db/schema";
import { feedback, feedbackReplies, user as userTable } from "@/lib/db/schema";
import { getErrorMessage } from "@/lib/error-utils";
import type { FeedbackUserSummary, FeedbackWithUser } from "@/types/admin/feedback";
import { and, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";

// ──────────────────────────────────────────────
//  Validation schemas
// ──────────────────────────────────────────────

const ListSchema = z.object({
  pageIndex: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  searchQuery: z.string().optional(),
  filterStatus: z.enum(FEEDBACK_STATUSES).optional(),
  filterType: z.enum(FEEDBACK_TYPES).optional(),
  filterPriority: z.enum(FEEDBACK_PRIORITIES).optional(),
});
const FeedbackIdSchema = z.string().uuid("Invalid feedback ID");

const ReplySchema = z.object({
  feedbackId: z.string().uuid("Invalid feedback ID"),
  content: z
    .string()
    .trim()
    .min(1, "Reply cannot be empty")
    .max(FEEDBACK_LIMITS.REPLY_MAX, `Reply must be under ${FEEDBACK_LIMITS.REPLY_MAX} characters`),
});

// ──────────────────────────────────────────────
//  Result types
// ──────────────────────────────────────────────

export type GetAllFeedbackResult = ActionResult<{
  feedbacks: FeedbackWithUser[];
  totalCount: number;
}>;

export type GetFeedbackDetailResult = ActionResult<{
  feedback: FeedbackRow & { user: FeedbackUserSummary };
  replies: FeedbackReplyRow[];
}>;

export type UpdateFeedbackStatusResult = ActionResult;
export type UpdateFeedbackPriorityResult = ActionResult;
export type AddAdminReplyResult = ActionResult<{ id: string }>;
export type DeleteFeedbackResult = ActionResult;

// ──────────────────────────────────────────────
//  1. getAllFeedback — paginated list with search & filters
// ──────────────────────────────────────────────

export async function getAllFeedback(
  params: z.infer<typeof ListSchema>,
): Promise<GetAllFeedbackResult> {
  if (!(await isAdmin())) {
    return actionResponse.forbidden("Admin privileges required.");
  }

  try {
    const { pageIndex, pageSize, searchQuery, filterStatus, filterType, filterPriority } =
      ListSchema.parse(params);

    // --- build WHERE conditions ---
    const conditions = [];

    if (searchQuery) {
      conditions.push(
        or(
          ilike(feedback.title, `%${searchQuery}%`),
          ilike(feedback.description, `%${searchQuery}%`),
          ilike(feedback.submitterEmail, `%${searchQuery}%`),
        ),
      );
    }

    if (filterStatus) {
      conditions.push(eq(feedback.status, filterStatus));
    }
    if (filterType) {
      conditions.push(eq(feedback.type, filterType));
    }
    if (filterPriority) {
      conditions.push(eq(feedback.priority, filterPriority));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // --- parallel: rows + total count ---
    const feedbackQuery = db
      .select({
        feedback,
        user: {
          id: userTable.id,
          email: userTable.email,
          name: userTable.name,
          image: userTable.image,
          banned: userTable.banned,
        },
      })
      .from(feedback)
      .leftJoin(userTable, eq(feedback.userId, userTable.id))
      .where(whereClause)
      .orderBy(desc(feedback.createdAt))
      .offset(pageIndex * pageSize)
      .limit(pageSize);

    const totalCountQuery = db.select({ value: count() }).from(feedback).where(whereClause);

    const [rows, totalCountResult] = await Promise.all([feedbackQuery, totalCountQuery]);
    const totalCount = totalCountResult[0].value;

    // --- batch fetch reply counts for this page ---
    const feedbackIds = rows.map((r) => r.feedback.id);
    let replyCountMap: Record<string, number> = {};

    if (feedbackIds.length > 0) {
      const replyCounts = await db
        .select({
          feedbackId: feedbackReplies.feedbackId,
          count: count(),
        })
        .from(feedbackReplies)
        .where(inArray(feedbackReplies.feedbackId, feedbackIds))
        .groupBy(feedbackReplies.feedbackId);

      replyCountMap = Object.fromEntries(replyCounts.map((r) => [r.feedbackId, r.count]));
    }

    // --- assemble response with user fallback for deleted accounts ---
    const feedbacks: FeedbackWithUser[] = rows.map((row) => ({
      ...row.feedback,
      user: row.user
        ? (row.user as FeedbackUserSummary)
        : {
            id: null,
            email: row.feedback.submitterEmail,
            name: row.feedback.submitterName,
            image: null,
            banned: null,
          },
      replyCount: replyCountMap[row.feedback.id] ?? 0,
    }));

    return actionResponse.success({ feedbacks, totalCount });
  } catch (error) {
    console.error("Error fetching feedback list:", error);
    return actionResponse.error(getErrorMessage(error));
  }
}

// ──────────────────────────────────────────────
//  2. getFeedbackDetail — single feedback + replies
// ──────────────────────────────────────────────

export async function getFeedbackDetail(feedbackId: string): Promise<GetFeedbackDetailResult> {
  if (!(await isAdmin())) {
    return actionResponse.forbidden("Admin privileges required.");
  }

  if (!FeedbackIdSchema.safeParse(feedbackId).success) {
    return actionResponse.badRequest("Invalid feedback ID");
  }

  try {
    const rows = await db
      .select({
        feedback,
        user: {
          id: userTable.id,
          email: userTable.email,
          name: userTable.name,
          image: userTable.image,
          banned: userTable.banned,
        },
      })
      .from(feedback)
      .leftJoin(userTable, eq(feedback.userId, userTable.id))
      .where(eq(feedback.id, feedbackId))
      .limit(1);

    if (rows.length === 0) {
      return actionResponse.notFound("Feedback not found.");
    }

    const row = rows[0];

    const replies = await db
      .select()
      .from(feedbackReplies)
      .where(eq(feedbackReplies.feedbackId, feedbackId))
      .orderBy(desc(feedbackReplies.createdAt));

    const userSummary: FeedbackUserSummary = row.user
      ? (row.user as FeedbackUserSummary)
      : {
          id: null,
          email: row.feedback.submitterEmail,
          name: row.feedback.submitterName,
          image: null,
          banned: null,
        };

    return actionResponse.success({
      feedback: { ...row.feedback, user: userSummary },
      replies,
    });
  } catch (error) {
    console.error("Error fetching feedback detail:", error);
    return actionResponse.error(getErrorMessage(error));
  }
}

// ──────────────────────────────────────────────
//  3. updateFeedbackStatus
// ──────────────────────────────────────────────

export async function updateFeedbackStatus({
  feedbackId,
  status,
}: {
  feedbackId: string;
  status: string;
}): Promise<UpdateFeedbackStatusResult> {
  if (!(await isAdmin())) {
    return actionResponse.forbidden("Admin privileges required.");
  }

  if (!FEEDBACK_STATUSES.includes(status as (typeof FEEDBACK_STATUSES)[number])) {
    return actionResponse.badRequest(`Invalid status: ${status}`);
  }
  if (!FeedbackIdSchema.safeParse(feedbackId).success) {
    return actionResponse.badRequest("Invalid feedback ID");
  }

  try {
    const result = await db
      .update(feedback)
      .set({
        status: status as (typeof FEEDBACK_STATUSES)[number],
        updatedAt: new Date(),
      })
      .where(eq(feedback.id, feedbackId))
      .returning({ id: feedback.id });

    if (result.length === 0) {
      return actionResponse.notFound("Feedback not found.");
    }

    return actionResponse.success();
  } catch (error) {
    console.error("Error updating feedback status:", error);
    return actionResponse.error(getErrorMessage(error));
  }
}

// ──────────────────────────────────────────────
//  4. updateFeedbackPriority
// ──────────────────────────────────────────────

export async function updateFeedbackPriority({
  feedbackId,
  priority,
}: {
  feedbackId: string;
  priority: string;
}): Promise<UpdateFeedbackPriorityResult> {
  if (!(await isAdmin())) {
    return actionResponse.forbidden("Admin privileges required.");
  }

  if (!FEEDBACK_PRIORITIES.includes(priority as (typeof FEEDBACK_PRIORITIES)[number])) {
    return actionResponse.badRequest(`Invalid priority: ${priority}`);
  }
  if (!FeedbackIdSchema.safeParse(feedbackId).success) {
    return actionResponse.badRequest("Invalid feedback ID");
  }

  try {
    const result = await db
      .update(feedback)
      .set({
        priority: priority as (typeof FEEDBACK_PRIORITIES)[number],
        updatedAt: new Date(),
      })
      .where(eq(feedback.id, feedbackId))
      .returning({ id: feedback.id });

    if (result.length === 0) {
      return actionResponse.notFound("Feedback not found.");
    }

    return actionResponse.success();
  } catch (error) {
    console.error("Error updating feedback priority:", error);
    return actionResponse.error(getErrorMessage(error));
  }
}

// ──────────────────────────────────────────────
//  5. addAdminReply
// ──────────────────────────────────────────────

export async function addAdminReply(
  params: z.infer<typeof ReplySchema>,
): Promise<AddAdminReplyResult> {
  if (!(await isAdmin())) {
    return actionResponse.forbidden("Admin privileges required.");
  }

  try {
    const { feedbackId, content } = ReplySchema.parse(params);

    const session = await getSession();
    if (!session?.user) {
      return actionResponse.unauthorized();
    }

    const inserted = await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: feedback.id })
        .from(feedback)
        .where(eq(feedback.id, feedbackId))
        .limit(1);

      if (!target) return null;

      const [reply] = await tx
        .insert(feedbackReplies)
        .values({
          feedbackId,
          authorId: session.user.id,
          authorEmail: session.user.email,
          authorName: session.user.name ?? null,
          isAdmin: true,
          content,
        })
        .returning({ id: feedbackReplies.id });

      if (!reply) {
        throw new Error("Failed to add reply.");
      }

      await tx.update(feedback).set({ updatedAt: new Date() }).where(eq(feedback.id, feedbackId));

      return reply;
    });

    if (!inserted) {
      return actionResponse.notFound("Feedback not found.");
    }
    if (!inserted.id) {
      return actionResponse.error("Failed to add reply.");
    }

    return actionResponse.success({ id: inserted.id });
  } catch (error) {
    console.error("Error adding admin reply:", error);
    return actionResponse.error(getErrorMessage(error));
  }
}

// ──────────────────────────────────────────────
//  6. deleteFeedback — superadmin only
// ──────────────────────────────────────────────

export async function deleteFeedback(feedbackId: string): Promise<DeleteFeedbackResult> {
  if (!(await isSuperAdmin())) {
    return actionResponse.forbidden("Super admin privileges required.");
  }

  if (!FeedbackIdSchema.safeParse(feedbackId).success) {
    return actionResponse.badRequest("Invalid feedback ID");
  }

  try {
    const result = await db
      .delete(feedback)
      .where(eq(feedback.id, feedbackId))
      .returning({ id: feedback.id });

    if (result.length === 0) {
      return actionResponse.notFound("Feedback not found.");
    }

    return actionResponse.success();
  } catch (error) {
    console.error("Error deleting feedback:", error);
    return actionResponse.error(getErrorMessage(error));
  }
}
