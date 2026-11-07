/**
 * App database schema.
 *
 * The Auth and Commerce physical model is reused verbatim from the public
 * adapter `@sunpcm/niu-persistence-pg` via `/schema/auth` and `/schema/commerce`.
 * Only app-specific content/feedback tables live here. Export names, column
 * names, inferred types, FK, enum, and index semantics are preserved for
 * existing consumers; the shared core tables are no longer redeclared here.
 */

// Re-export the shared Auth/Commerce physical model (same export names and
// inferred types as the previous in-app definitions).
export * from "@sunpcm/niu-persistence-pg/schema/auth";
export * from "@sunpcm/niu-persistence-pg/schema/commerce";
export * from "@sunpcm/niu-persistence-pg/schema/nano";

// Local binding needed by the app-specific tables' foreign keys below.
import { user } from "@sunpcm/niu-persistence-pg/schema/auth";

import {
  boolean,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ============================================
// App content model (CMS)
// ============================================

export const postTypeEnum = pgEnum('post_type', [
  'blog',
  'glossary',
])
export type PostType = (typeof postTypeEnum.enumValues)[number]

export const postStatusEnum = pgEnum('post_status', [
  'draft',
  'published',
  'archived',
])
export type PostStatus = (typeof postStatusEnum.enumValues)[number]

export const postVisibilityEnum = pgEnum('post_visibility', [
  'public',
  'logged_in',
  'subscribers',
])

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    language: varchar('language', { length: 10 }).notNull(),
    postType: postTypeEnum('post_type').default('blog'),
    authorId: uuid('author_id')
      .references(() => user.id, { onDelete: 'set null' })
      .notNull(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    content: text('content'),
    description: text('description'),
    featuredImageUrl: text('featured_image_url'),
    isPinned: boolean('is_pinned').default(false).notNull(),
    status: postStatusEnum('status').default('draft').notNull(),
    visibility: postVisibilityEnum('visibility').default('public').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => {
    return {
      languageSlugPostTypeUnique: unique('posts_language_slug_post_type_unique').on(
        table.language,
        table.slug,
        table.postType
      ),
      authorIdIdx: index('idx_posts_author_id').on(table.authorId),
      postTypeIdx: index('idx_posts_post_type').on(table.postType),
      statusIdx: index('idx_posts_status').on(table.status),
      visibilityIdx: index('idx_posts_visibility').on(table.visibility),
      languageStatusIdx: index('idx_posts_language_status').on(
        table.language,
        table.status
      ),
      languagePostTypeStatusIdx: index('idx_posts_language_post_type_status').on(
        table.language,
        table.postType,
        table.status
      ),
    }
  }
)

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    postType: postTypeEnum('post_type').default('blog'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => {
    return {
      nameIdx: index('idx_tags_name').on(table.name),
      namePostTypeUnique: unique('tags_name_post_type_unique').on(
        table.name,
        table.postType
      ),
    }
  }
)

export const postTags = pgTable(
  'post_tags',
  {
    postId: uuid('post_id')
      .references(() => posts.id, { onDelete: 'cascade' })
      .notNull(),
    tagId: uuid('tag_id')
      .references(() => tags.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.postId, table.tagId] }),
      postIdIdx: index('idx_post_tags_post_id').on(table.postId),
      tagIdIdx: index('idx_post_tags_tag_id').on(table.tagId),
    }
  }
)

// ============================================
// Feedback System
// ============================================

export const feedbackTypeEnum = pgEnum('feedback_type', [
  'feature_request',
  'bug_report',
  'improvement',
  'other',
])
export type FeedbackType = (typeof feedbackTypeEnum.enumValues)[number]

export const feedbackStatusEnum = pgEnum('feedback_status', [
  'submitted',
  'under_review',
  'planned',
  'in_progress',
  'completed',
  'declined',
])
export type FeedbackStatus = (typeof feedbackStatusEnum.enumValues)[number]

export const feedbackPriorityEnum = pgEnum('feedback_priority', [
  'low',
  'medium',
  'high',
])
export type FeedbackPriority = (typeof feedbackPriorityEnum.enumValues)[number]

export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    submitterEmail: text('submitter_email').notNull(),
    submitterName: text('submitter_name'),
    type: feedbackTypeEnum('type').notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    description: text('description').notNull(),
    priority: feedbackPriorityEnum('priority').default('medium').notNull(),
    status: feedbackStatusEnum('status').default('submitted').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userCreatedAtIdx: index('idx_feedback_user_created_at').on(table.userId, table.createdAt),
    statusIdx: index('idx_feedback_status').on(table.status),
    typeIdx: index('idx_feedback_type').on(table.type),
    createdAtIdx: index('idx_feedback_created_at').on(table.createdAt),
  })
)

export type FeedbackRow = typeof feedback.$inferSelect

export const feedbackReplies = pgTable(
  'feedback_replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    feedbackId: uuid('feedback_id')
      .references(() => feedback.id, { onDelete: 'cascade' })
      .notNull(),
    authorId: uuid('author_id').references(() => user.id, { onDelete: 'set null' }),
    authorEmail: text('author_email').notNull(),
    authorName: text('author_name'),
    isAdmin: boolean('is_admin').default(false).notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    feedbackCreatedAtIdx: index('idx_feedback_replies_feedback_created_at').on(
      table.feedbackId,
      table.createdAt
    ),
  })
)

export type FeedbackReplyRow = typeof feedbackReplies.$inferSelect
