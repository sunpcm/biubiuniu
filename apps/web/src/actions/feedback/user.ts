"use server";

/**
 * [INPUT]: Depends on @/lib/auth/server for getSession, @/lib/db for database,
 *          @/lib/db/schema for feedback/feedbackReplies/user tables,
 *          @/lib/action-response for ActionResult/actionResponse,
 *          @/constants/feedback for FEEDBACK_LIMITS/FEEDBACK_TYPES,
 *          @/types/admin/feedback for FeedbackWithReplyCount
 * [OUTPUT]: Exports createFeedback, getMyFeedback, getMyFeedbackDetail, addUserReply
 *           and their result types
 * [POS]: User-facing server actions for the feedback system, sibling to future admin.ts
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { ActionResult, actionResponse } from "@/lib/action-response";
import { getSession } from "@/lib/auth/server";
import { FEEDBACK_LIMITS, FEEDBACK_STATUSES, FEEDBACK_TYPES } from "@/constants/feedback";
import { db } from "@/lib/db";
import {
  feedback,
  feedbackReplies,
  user as userTable,
  type FeedbackRow,
  type FeedbackReplyRow,
} from "@/lib/db/schema";
import { getErrorMessage } from "@/lib/error-utils";
import { FeedbackWithReplyCount } from "@/types/admin/feedback";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

// ============================================================
// Validation Schemas
// ============================================================

const CreateFeedbackSchema = z.object({
  type: z.enum(FEEDBACK_TYPES),
  title: z
    .string()
    .trim()
    .min(
      FEEDBACK_LIMITS.TITLE_MIN,
      `Title must be at least ${FEEDBACK_LIMITS.TITLE_MIN} characters`,
    )
    .max(
      FEEDBACK_LIMITS.TITLE_MAX,
      `Title must be at most ${FEEDBACK_LIMITS.TITLE_MAX} characters`,
    ),
  description: z
    .string()
    .trim()
    .min(
      FEEDBACK_LIMITS.DESCRIPTION_MIN,
      `Description must be at least ${FEEDBACK_LIMITS.DESCRIPTION_MIN} characters`,
    )
    .max(
      FEEDBACK_LIMITS.DESCRIPTION_MAX,
      `Description must be at most ${FEEDBACK_LIMITS.DESCRIPTION_MAX} characters`,
    ),
});

const GetMyFeedbackSchema = z.object({
  pageIndex: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  filterType: z.enum(FEEDBACK_TYPES).optional(),
  filterStatus: z.enum(FEEDBACK_STATUSES).optional(),
});

const AddUserReplySchema = z.object({
  feedbackId: z.string().uuid("Invalid feedback ID"),
  content: z
    .string()
    .trim()
    .min(1, "Reply content cannot be empty")
    .max(
      FEEDBACK_LIMITS.REPLY_MAX,
      `Reply must be at most ${FEEDBACK_LIMITS.REPLY_MAX} characters`,
    ),
});

// ============================================================
// Result Types
// ============================================================

export type CreateFeedbackResult = ActionResult<{ id: string }>;
export type GetMyFeedbackResult = ActionResult<{
  feedbacks: FeedbackWithReplyCount[];
  totalCount: number;
}>;
export type GetMyFeedbackDetailResult = ActionResult<{
  feedback: FeedbackRow;
  replies: FeedbackReplyRow[];
}>;
export type AddUserReplyResult = ActionResult<{ id: string }>;

// ============================================================
// createFeedback — Submit new feedback
// ============================================================

export async function createFeedback(
  params: z.infer<typeof CreateFeedbackSchema>,
): Promise<CreateFeedbackResult> {
  const session = await getSession();
  const currentUser = session?.user;
  if (!currentUser) return actionResponse.unauthorized();

  try {
    const parsed = CreateFeedbackSchema.parse(params);

    // Check if the user is banned
    const [userRecord] = await db
      .select({ banned: userTable.banned })
      .from(userTable)
      .where(eq(userTable.id, currentUser.id))
      .limit(1);

    if (userRecord?.banned) {
      return actionResponse.forbidden("Your account is currently restricted.");
    }

    // Snapshot email/name at submission time
    const [inserted] = await db
      .insert(feedback)
      .values({
        userId: currentUser.id,
        submitterEmail: currentUser.email,
        submitterName: currentUser.name ?? null,
        type: parsed.type,
        title: parsed.title,
        description: parsed.description,
      })
      .returning({ id: feedback.id });

    if (!inserted) {
      return actionResponse.error("Failed to create feedback.");
    }

    return actionResponse.success({ id: inserted.id });
  } catch (err) {
    return actionResponse.error(getErrorMessage(err));
  }
}

// ============================================================
// getMyFeedback — List user's own feedback with pagination
// ============================================================

export async function getMyFeedback(
  params: z.infer<typeof GetMyFeedbackSchema>,
): Promise<GetMyFeedbackResult> {
  const session = await getSession();
  const currentUser = session?.user;
  if (!currentUser) return actionResponse.unauthorized();

  try {
    const { pageIndex, pageSize, filterType, filterStatus } = GetMyFeedbackSchema.parse(params);

    // Build WHERE conditions
    const conditions = [eq(feedback.userId, currentUser.id)];

    if (filterType) {
      conditions.push(eq(feedback.type, filterType));
    }

    if (filterStatus) {
      conditions.push(eq(feedback.status, filterStatus));
    }

    const whereClause = and(...conditions);

    // Parallel: fetch page + total count
    const [feedbackRows, totalCountResult] = await Promise.all([
      db
        .select()
        .from(feedback)
        .where(whereClause)
        .orderBy(desc(feedback.updatedAt))
        .offset(pageIndex * pageSize)
        .limit(pageSize),
      db.select({ value: count() }).from(feedback).where(whereClause),
    ]);

    const totalCount = totalCountResult[0].value;

    if (feedbackRows.length === 0) {
      return actionResponse.success({ feedbacks: [], totalCount });
    }

    // Batch fetch reply counts + latest reply per feedback
    const feedbackIds = feedbackRows.map((f) => f.id);

    const [replyCounts, latestReplies] = await Promise.all([
      // Reply counts per feedback
      db
        .select({
          feedbackId: feedbackReplies.feedbackId,
          count: count(),
        })
        .from(feedbackReplies)
        .where(inArray(feedbackReplies.feedbackId, feedbackIds))
        .groupBy(feedbackReplies.feedbackId),

      // Latest reply per feedback using DISTINCT ON
      db
        .selectDistinctOn([feedbackReplies.feedbackId], {
          feedbackId: feedbackReplies.feedbackId,
          content: feedbackReplies.content,
          createdAt: feedbackReplies.createdAt,
          isAdmin: feedbackReplies.isAdmin,
        })
        .from(feedbackReplies)
        .where(inArray(feedbackReplies.feedbackId, feedbackIds))
        .orderBy(feedbackReplies.feedbackId, desc(feedbackReplies.createdAt)),
    ]);

    // Index for O(1) lookups
    const replyCountMap = new Map(replyCounts.map((r) => [r.feedbackId, r.count]));
    const latestReplyMap = new Map(
      latestReplies.map((r) => [
        r.feedbackId,
        { content: r.content, createdAt: r.createdAt, isAdmin: r.isAdmin },
      ]),
    );

    const feedbacks: FeedbackWithReplyCount[] = feedbackRows.map((f) => ({
      ...f,
      replyCount: replyCountMap.get(f.id) ?? 0,
      latestReply: latestReplyMap.get(f.id) ?? null,
    }));

    return actionResponse.success({
      feedbacks,
      totalCount,
    });
  } catch (err) {
    return actionResponse.error(getErrorMessage(err));
  }
}

// ============================================================
// getMyFeedbackDetail — Single feedback with all replies
// ============================================================

export async function getMyFeedbackDetail(feedbackId: string): Promise<GetMyFeedbackDetailResult> {
  const session = await getSession();
  const currentUser = session?.user;
  if (!currentUser) return actionResponse.unauthorized();

  try {
    if (!z.string().uuid().safeParse(feedbackId).success) {
      return actionResponse.badRequest("Invalid feedback ID");
    }

    // Fetch feedback and enforce ownership
    const [feedbackRow] = await db
      .select()
      .from(feedback)
      .where(and(eq(feedback.id, feedbackId), eq(feedback.userId, currentUser.id)))
      .limit(1);

    if (!feedbackRow) {
      return actionResponse.notFound("Feedback not found.");
    }

    // Fetch all replies ordered chronologically
    const replies = await db
      .select()
      .from(feedbackReplies)
      .where(eq(feedbackReplies.feedbackId, feedbackId))
      .orderBy(feedbackReplies.createdAt);

    return actionResponse.success({ feedback: feedbackRow, replies });
  } catch (err) {
    return actionResponse.error(getErrorMessage(err));
  }
}

// ============================================================
// addUserReply — Add reply to own feedback
// ============================================================

export async function addUserReply(
  params: z.infer<typeof AddUserReplySchema>,
): Promise<AddUserReplyResult> {
  const session = await getSession();
  const currentUser = session?.user;
  if (!currentUser) return actionResponse.unauthorized();

  try {
    const { feedbackId, content } = AddUserReplySchema.parse(params);

    const inserted = await db.transaction(async (tx) => {
      const [feedbackRow] = await tx
        .select({ id: feedback.id })
        .from(feedback)
        .where(and(eq(feedback.id, feedbackId), eq(feedback.userId, currentUser.id)))
        .limit(1);

      if (!feedbackRow) return null;

      const [reply] = await tx
        .insert(feedbackReplies)
        .values({
          feedbackId,
          authorId: currentUser.id,
          authorEmail: currentUser.email,
          authorName: currentUser.name ?? null,
          isAdmin: false,
          content,
        })
        .returning({ id: feedbackReplies.id });

      if (!reply) {
        throw new Error("Failed to add reply.");
      }

      await tx.update(feedback).set({ updatedAt: new Date() }).where(eq(feedback.id, feedbackId));

      return reply;
    });

    if (!inserted) return actionResponse.notFound("Feedback not found.");

    return actionResponse.success({ id: inserted.id });
  } catch (err) {
    return actionResponse.error(getErrorMessage(err));
  }
}
