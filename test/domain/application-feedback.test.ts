import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { eq, sql } from "drizzle-orm";

import { closeDatabase, db } from "@/lib/db";
import { feedback, feedbackReplies, user as userTable } from "@/lib/db/schema";
import { migrate, resetSyntheticData } from "./helpers";

interface Actor {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin" | "superadmin";
}

let actor: Actor | null = null;

mock.module("@/lib/auth/server", {
  exports: {
    getSession: async () =>
      actor
        ? {
            user: {
              id: actor.id,
              email: actor.email,
              name: actor.name,
              role: actor.role,
            },
          }
        : null,
    isAdmin: async () => actor?.role === "admin" || actor?.role === "superadmin",
    isSuperAdmin: async () => actor?.role === "superadmin",
  },
});

let normalUser: Actor;
let otherUser: Actor;
let adminUser: Actor;

async function createUser(prefix: string, role: Actor["role"]): Promise<Actor> {
  const [row] = await db
    .insert(userTable)
    .values({
      email: `${prefix}-${crypto.randomUUID()}@example.invalid`,
      name: `${prefix} user`,
      role,
    })
    .returning({
      id: userTable.id,
      email: userTable.email,
      name: userTable.name,
      role: userTable.role,
    });

  return {
    id: row.id,
    email: row.email,
    name: row.name ?? `${prefix} user`,
    role: row.role,
  };
}

async function createFeedbackAs(user: Actor, title = "Feedback ownership check") {
  actor = user;
  const { createFeedback } = await import("@/actions/feedback/user");
  const result = await createFeedback({
    type: "bug_report",
    title,
    description: "This feedback description is long enough for validation.",
  });
  if (!result.success) assert.fail(result.error);
  const feedbackId = result.data?.id;
  assert.ok(feedbackId);
  return feedbackId;
}

before(async () => {
  await migrate();
});

beforeEach(async () => {
  await resetSyntheticData();
  normalUser = await createUser("feedback-user", "user");
  otherUser = await createUser("feedback-other", "user");
  adminUser = await createUser("feedback-admin", "admin");
  actor = null;
});

after(async () => {
  await closeDatabase();
});

test("feedback ownership protects reads and replies from another user", async () => {
  const feedbackId = await createFeedbackAs(normalUser);
  const { getMyFeedbackDetail, addUserReply } = await import("@/actions/feedback/user");

  actor = otherUser;
  const detail = await getMyFeedbackDetail(feedbackId);
  if (detail.success) assert.fail("another user could read the feedback");
  assert.match(detail.error, /not found/i);

  const reply = await addUserReply({
    feedbackId,
    content: "This reply must never be accepted.",
  });
  if (reply.success) assert.fail("another user could reply to the feedback");
  assert.match(reply.error, /not found/i);

  const replies = await db.select({ id: feedbackReplies.id }).from(feedbackReplies);
  assert.equal(replies.length, 0);
});

test("feedback list filters and feedback IDs reject invalid input", async () => {
  actor = normalUser;
  const { addUserReply, getMyFeedback, getMyFeedbackDetail } =
    await import("@/actions/feedback/user");
  type ListInput = Parameters<typeof getMyFeedback>[0];

  const invalidFilter = await getMyFeedback({
    filterStatus: "not-a-status",
  } as unknown as ListInput);
  if (invalidFilter.success) assert.fail("invalid feedback status filter was accepted");

  const invalidDetail = await getMyFeedbackDetail("not-a-uuid");
  if (invalidDetail.success) assert.fail("invalid feedback detail ID was accepted");

  const invalidReply = await addUserReply({
    feedbackId: "not-a-uuid",
    content: "This input must fail before any insert.",
  });
  if (invalidReply.success) assert.fail("invalid feedback reply ID was accepted");
});

test("feedback admin permissions are checked at the server action boundary", async () => {
  const feedbackId = await createFeedbackAs(normalUser);
  const { getAllFeedback, updateFeedbackStatus } = await import("@/actions/feedback/admin");

  actor = normalUser;
  const list = await getAllFeedback({ pageIndex: 0, pageSize: 10 });
  if (list.success) assert.fail("ordinary user could list admin feedback");
  assert.match(list.error, /Admin privileges/);

  const update = await updateFeedbackStatus({
    feedbackId,
    status: "completed",
  });
  if (update.success) assert.fail("ordinary user could update feedback status");
  assert.match(update.error, /Admin privileges/);

  const [row] = await db
    .select({ status: feedback.status })
    .from(feedback)
    .where(eq(feedback.id, feedbackId));
  assert.equal(row.status, "submitted");
});

test("admin feedback status, replies and detail use the real persisted entries", async () => {
  const feedbackId = await createFeedbackAs(normalUser);
  const { addAdminReply, getAllFeedback, getFeedbackDetail, updateFeedbackStatus } =
    await import("@/actions/feedback/admin");

  actor = adminUser;
  const list = await getAllFeedback({
    pageIndex: 0,
    pageSize: 10,
    searchQuery: "ownership",
    filterStatus: "submitted",
    filterType: "bug_report",
    filterPriority: "medium",
  });
  if (!list.success) assert.fail(list.error);
  assert.equal(list.data?.totalCount, 1);
  assert.equal(list.data?.feedbacks[0].id, feedbackId);

  const status = await updateFeedbackStatus({
    feedbackId,
    status: "in_progress",
  });
  if (!status.success) assert.fail(status.error);

  const reply = await addAdminReply({
    feedbackId,
    content: "We have reproduced this issue.",
  });
  if (!reply.success) assert.fail(reply.error);

  const detail = await getFeedbackDetail(feedbackId);
  if (!detail.success) assert.fail(detail.error);
  assert.equal(detail.data?.feedback.status, "in_progress");
  assert.equal(detail.data?.replies[0].isAdmin, true);
  assert.equal(detail.data?.replies[0].content, "We have reproduced this issue.");
});

test("a failed feedback reply leaves updatedAt and reply storage unchanged", async () => {
  const feedbackId = await createFeedbackAs(normalUser);
  const original = (
    await db
      .select({ updatedAt: feedback.updatedAt })
      .from(feedback)
      .where(eq(feedback.id, feedbackId))
  )[0].updatedAt;

  await db.execute(
    sql.raw(`
    create function n2_fail_feedback_reply() returns trigger
    language plpgsql as $$
    begin
      raise exception 'synthetic reply failure';
    end;
    $$
  `),
  );
  await db.execute(
    sql.raw(`
    create trigger n2_fail_feedback_reply
    before insert on feedback_replies
    for each row execute function n2_fail_feedback_reply()
  `),
  );

  try {
    actor = normalUser;
    const { addUserReply } = await import("@/actions/feedback/user");
    const reply = await addUserReply({
      feedbackId,
      content: "This insert is forced to fail.",
    });
    if (reply.success) assert.fail("synthetic reply failure was ignored");

    const replies = await db.select({ id: feedbackReplies.id }).from(feedbackReplies);
    assert.equal(replies.length, 0);
    const afterFailure = (
      await db
        .select({ updatedAt: feedback.updatedAt })
        .from(feedback)
        .where(eq(feedback.id, feedbackId))
    )[0].updatedAt;
    assert.equal(afterFailure.getTime(), original.getTime());
  } finally {
    await db.execute(sql.raw("drop trigger if exists n2_fail_feedback_reply on feedback_replies"));
    await db.execute(sql.raw("drop function if exists n2_fail_feedback_reply()"));
  }
});

test("admin overview feedback count comes from the real open-status rows", async () => {
  await db.insert(feedback).values([
    {
      userId: normalUser.id,
      submitterEmail: normalUser.email,
      type: "feature_request",
      title: "Submitted feedback",
      description: "Submitted feedback description for the overview count.",
      status: "submitted",
    },
    {
      userId: otherUser.id,
      submitterEmail: otherUser.email,
      type: "improvement",
      title: "Under review feedback",
      description: "Under-review feedback description for the overview count.",
      status: "under_review",
    },
    {
      userId: normalUser.id,
      submitterEmail: normalUser.email,
      type: "other",
      title: "Completed feedback",
      description: "Completed feedback description for the overview count.",
      status: "completed",
    },
  ]);

  const { getOverviewAttention } = await import("@/actions/overview");
  actor = normalUser;
  const denied = await getOverviewAttention("7d");
  if (denied.success) assert.fail("ordinary user could read admin overview");
  assert.match(denied.error, /Admin privileges/);

  actor = adminUser;
  const result = await getOverviewAttention("7d");
  if (!result.success) assert.fail(result.error);
  assert.equal(result.data?.openFeedback, 2);
});
