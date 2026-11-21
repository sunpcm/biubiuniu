import type { FeedbackRow, FeedbackReplyRow } from "@/lib/db/schema";

export type FeedbackUserSummary = {
  id: string | null;
  email: string;
  name: string | null;
  image: string | null;
  banned: boolean | null;
};

export type FeedbackWithUser = FeedbackRow & {
  user: FeedbackUserSummary;
  replyCount: number;
};

export type FeedbackWithReplies = FeedbackRow & {
  replies: FeedbackReplyRow[];
};

export type FeedbackWithReplyCount = FeedbackRow & {
  replyCount: number;
  latestReply: Pick<FeedbackReplyRow, "content" | "createdAt" | "isAdmin"> | null;
};
