export const FEEDBACK_LIMITS = {
  TITLE_MIN: 5,
  TITLE_MAX: 120,
  DESCRIPTION_MIN: 20,
  DESCRIPTION_MAX: 2000,
  REPLY_MAX: 500,
} as const;

export const FEEDBACK_TYPES = ["feature_request", "bug_report", "improvement", "other"] as const;
export const FEEDBACK_STATUSES = [
  "submitted",
  "under_review",
  "planned",
  "in_progress",
  "completed",
  "declined",
] as const;
export const FEEDBACK_PRIORITIES = ["low", "medium", "high"] as const;

export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number];

export function isFeedbackType(value: string): value is FeedbackType {
  return FEEDBACK_TYPES.some((type) => type === value);
}

export function isFeedbackStatus(value: string): value is FeedbackStatus {
  return FEEDBACK_STATUSES.some((status) => status === value);
}

export function isFeedbackPriority(value: string): value is FeedbackPriority {
  return FEEDBACK_PRIORITIES.some((priority) => priority === value);
}

export const FEEDBACK_TYPE_ICONS: Record<FeedbackType, string> = {
  feature_request: "Lightbulb",
  bug_report: "Bug",
  improvement: "Sparkles",
  other: "Wrench",
};

export const FEEDBACK_STATUS_COLORS: Record<FeedbackStatus, string> = {
  submitted: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  under_review: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  planned: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  in_progress: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  declined: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

export const FEEDBACK_PRIORITY_COLORS: Record<FeedbackPriority, string> = {
  low: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  high: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

export const FEEDBACK_DRAFT_KEY = "nexty_feedback_draft";
export const FEEDBACK_DRAFT_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
