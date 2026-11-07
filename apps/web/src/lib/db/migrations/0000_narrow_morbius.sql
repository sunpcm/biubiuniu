CREATE TYPE "public"."credit_transaction_type" AS ENUM('purchase', 'subscription_grant', 'subscription_cycle_expire', 'usage', 'usage_refund', 'refund_revoke', 'subscription_end_revoke', 'admin_adjustment', 'signup_bonus');--> statement-breakpoint
CREATE TYPE "public"."feedback_priority" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('submitted', 'under_review', 'planned', 'in_progress', 'completed', 'declined');--> statement-breakpoint
CREATE TYPE "public"."feedback_type" AS ENUM('feature_request', 'bug_report', 'improvement', 'other');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'completed', 'partially_refunded', 'refunded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('one_time', 'subscription_initial', 'subscription_renewal', 'subscription_upgrade');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('stripe', 'creem', 'paypal');--> statement-breakpoint
CREATE TYPE "public"."plan_interval" AS ENUM('month', 'year');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."post_type" AS ENUM('blog', 'glossary');--> statement-breakpoint
CREATE TYPE "public"."post_visibility" AS ENUM('public', 'logged_in', 'subscribers');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin', 'superadmin');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_balances" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"subscription_credits" integer DEFAULT 0 NOT NULL,
	"purchased_credits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "credit_transactions_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid,
	"organization_id" uuid,
	"type" "credit_transaction_type" NOT NULL,
	"amount" integer NOT NULL,
	"subscription_delta" integer DEFAULT 0 NOT NULL,
	"purchased_delta" integer DEFAULT 0 NOT NULL,
	"subscription_credits_after" integer NOT NULL,
	"purchased_credits_after" integer NOT NULL,
	"note" text,
	"order_id" uuid,
	"refunded_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_transactions_refunded_transaction_id_unique" UNIQUE("refunded_transaction_id")
);
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
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"inviter_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_member_org_user" UNIQUE("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"plan_id" text NOT NULL,
	"order_type" "order_type" NOT NULL,
	"status" "order_status" DEFAULT 'completed' NOT NULL,
	"credits_granted" integer DEFAULT 0 NOT NULL,
	"amount_total" integer NOT NULL,
	"amount_subtotal" integer,
	"amount_discount" integer DEFAULT 0 NOT NULL,
	"amount_tax" integer DEFAULT 0 NOT NULL,
	"amount_refunded" integer DEFAULT 0 NOT NULL,
	"currency" varchar(10) NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"provider_order_id" text NOT NULL,
	"provider_payment_id" text,
	"provider_subscription_id" text,
	"refunded_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "organization_credit_balances" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"subscription_credits" integer DEFAULT 0 NOT NULL,
	"purchased_credits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"active_organization_id" uuid,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"plan_id" text NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"provider_customer_id" text,
	"provider_price_id" text,
	"status" text NOT NULL,
	"interval" "plan_interval" NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"monthly_credits" integer DEFAULT 0 NOT NULL,
	"remaining_grants" integer DEFAULT 0 NOT NULL,
	"next_grant_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text,
	"image" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"stripe_customer_id" text,
	"creem_customer_id" text,
	"paypal_payer_id" text,
	"banned" boolean,
	"ban_reason" text,
	"ban_expires" timestamp,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "user_creem_customer_id_unique" UNIQUE("creem_customer_id"),
	CONSTRAINT "user_paypal_payer_id_unique" UNIQUE("paypal_payer_id")
);
--> statement-breakpoint
CREATE TABLE "user_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"aff_code" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_term" text,
	"utm_content" text,
	"referrer" text,
	"referrer_domain" text,
	"landing_page" text,
	"user_agent" text,
	"browser" text,
	"browser_version" text,
	"os" text,
	"os_version" text,
	"device_type" text,
	"device_brand" text,
	"device_model" text,
	"screen_width" integer,
	"screen_height" integer,
	"language" text,
	"timezone" text,
	"ip_address" text,
	"country_code" varchar(2),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_refunded_transaction_id_credit_transactions_id_fk" FOREIGN KEY ("refunded_transaction_id") REFERENCES "public"."credit_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_replies" ADD CONSTRAINT "feedback_replies_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_replies" ADD CONSTRAINT "feedback_replies_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_credit_balances" ADD CONSTRAINT "organization_credit_balances_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_source" ADD CONSTRAINT "user_source_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_credit_transactions_user_created_at" ON "credit_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_credit_transactions_org_created_at" ON "credit_transactions" USING btree ("organization_id","created_at") WHERE "credit_transactions"."organization_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_credit_transactions_type" ON "credit_transactions" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_credit_transactions_order_id" ON "credit_transactions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_feedback_user_created_at" ON "feedback" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_feedback_status" ON "feedback" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_feedback_type" ON "feedback" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_feedback_created_at" ON "feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_feedback_replies_feedback_created_at" ON "feedback_replies" USING btree ("feedback_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_invitation_organization_id" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_invitation_email" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_member_organization_id" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_member_user_id" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_orders_user_id" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_orders_organization_id" ON "orders" USING btree ("organization_id") WHERE "orders"."organization_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_orders_plan_id" ON "orders" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idx_orders_created_at" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_orders_provider_order_id" ON "orders" USING btree ("provider","provider_order_id");--> statement-breakpoint
CREATE INDEX "idx_orders_provider_payment_id" ON "orders" USING btree ("provider_payment_id");--> statement-breakpoint
CREATE INDEX "idx_orders_provider_subscription_id" ON "orders" USING btree ("provider_subscription_id");--> statement-breakpoint
CREATE INDEX "idx_post_tags_post_id" ON "post_tags" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "idx_post_tags_tag_id" ON "post_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "idx_posts_author_id" ON "posts" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "idx_posts_post_type" ON "posts" USING btree ("post_type");--> statement-breakpoint
CREATE INDEX "idx_posts_status" ON "posts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_posts_visibility" ON "posts" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "idx_posts_language_status" ON "posts" USING btree ("language","status");--> statement-breakpoint
CREATE INDEX "idx_posts_language_post_type_status" ON "posts" USING btree ("language","post_type","status");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_user_id" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_organization_id" ON "subscriptions" USING btree ("organization_id") WHERE "subscriptions"."organization_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_subscriptions_status" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_plan_id" ON "subscriptions" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subscriptions_provider_subscription_id" ON "subscriptions" USING btree ("provider","provider_subscription_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_next_grant_at" ON "subscriptions" USING btree ("next_grant_at") WHERE "subscriptions"."next_grant_at" is not null;--> statement-breakpoint
CREATE INDEX "idx_subscriptions_current_period_end" ON "subscriptions" USING btree ("current_period_end") WHERE "subscriptions"."current_period_end" is not null;--> statement-breakpoint
CREATE INDEX "idx_tags_name" ON "tags" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_user_source_user_id" ON "user_source" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_source_aff_code" ON "user_source" USING btree ("aff_code");--> statement-breakpoint
CREATE INDEX "idx_user_source_utm_source" ON "user_source" USING btree ("utm_source");--> statement-breakpoint
CREATE INDEX "idx_user_source_country_code" ON "user_source" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX "idx_user_source_created_at" ON "user_source" USING btree ("created_at");