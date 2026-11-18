import type { MigrationModule } from "@sunpcm/niu-persistence-pg/migrations";

/**
 * BiuBiuNiu CMS and feedback persistence.
 *
 * This is the product-owned slice of the frozen N2 baseline. Keep the SQL
 * immutable once applied; later schema changes must append a new module.
 */
export const cmsFeedbackModule: MigrationModule = {
  name: "cms_feedback",
  version: 1,
  contractVersion: 1,
  description: "CMS posts, tags, feedback and reply tables",
  dependencies: ["auth"],
  sql: `CREATE TYPE "public"."feedback_priority" AS ENUM('low', 'medium', 'high');
--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('submitted', 'under_review', 'planned', 'in_progress', 'completed', 'declined');
--> statement-breakpoint
CREATE TYPE "public"."feedback_type" AS ENUM('feature_request', 'bug_report', 'improvement', 'other');
--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('draft', 'published', 'archived');
--> statement-breakpoint
CREATE TYPE "public"."post_type" AS ENUM('blog', 'glossary');
--> statement-breakpoint
CREATE TYPE "public"."post_visibility" AS ENUM('public', 'logged_in', 'subscribers');
--> statement-breakpoint
CREATE TABLE "feedback" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid,
  "submitter_email" text NOT NULL,
  "submitter_name" text,
  "type" "feedback_type" NOT NULL,
  "title" varchar(120) NOT NULL,
  "description" text NOT NULL,
  "priority" "feedback_priority" DEFAULT 'medium' NOT NULL,
  "status" "feedback_status" DEFAULT 'submitted' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_replies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "feedback_id" uuid NOT NULL,
  "author_id" uuid,
  "author_email" text NOT NULL,
  "author_name" text,
  "is_admin" boolean DEFAULT false NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_tags" (
  "post_id" uuid NOT NULL,
  "tag_id" uuid NOT NULL,
  CONSTRAINT "post_tags_post_id_tag_id_pk" PRIMARY KEY("post_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "posts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "language" varchar(10) NOT NULL,
  "post_type" "post_type" DEFAULT 'blog',
  "author_id" uuid NOT NULL,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "content" text,
  "description" text,
  "featured_image_url" text,
  "is_pinned" boolean DEFAULT false NOT NULL,
  "status" "post_status" DEFAULT 'draft' NOT NULL,
  "visibility" "post_visibility" DEFAULT 'public' NOT NULL,
  "published_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "posts_language_slug_post_type_unique" UNIQUE("language","slug","post_type")
);
--> statement-breakpoint
CREATE TABLE "tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "post_type" "post_type" DEFAULT 'blog',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tags_name_post_type_unique" UNIQUE("name","post_type")
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "feedback_replies" ADD CONSTRAINT "feedback_replies_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "feedback_replies" ADD CONSTRAINT "feedback_replies_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_feedback_user_created_at" ON "feedback" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX "idx_feedback_status" ON "feedback" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "idx_feedback_type" ON "feedback" USING btree ("type");
--> statement-breakpoint
CREATE INDEX "idx_feedback_created_at" ON "feedback" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "idx_feedback_replies_feedback_created_at" ON "feedback_replies" USING btree ("feedback_id","created_at");
--> statement-breakpoint
CREATE INDEX "idx_post_tags_post_id" ON "post_tags" USING btree ("post_id");
--> statement-breakpoint
CREATE INDEX "idx_post_tags_tag_id" ON "post_tags" USING btree ("tag_id");
--> statement-breakpoint
CREATE INDEX "idx_posts_author_id" ON "posts" USING btree ("author_id");
--> statement-breakpoint
CREATE INDEX "idx_posts_post_type" ON "posts" USING btree ("post_type");
--> statement-breakpoint
CREATE INDEX "idx_posts_status" ON "posts" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "idx_posts_visibility" ON "posts" USING btree ("visibility");
--> statement-breakpoint
CREATE INDEX "idx_posts_language_status" ON "posts" USING btree ("language","status");
--> statement-breakpoint
CREATE INDEX "idx_posts_language_post_type_status" ON "posts" USING btree ("language","post_type","status");
--> statement-breakpoint
CREATE INDEX "idx_tags_name" ON "tags" USING btree ("name");`,
};
