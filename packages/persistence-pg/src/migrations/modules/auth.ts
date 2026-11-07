import type { MigrationModule } from "../types.js";

/**
 * Auth identity + organization + attribution module.
 *
 * New-product baseline equivalent of the N2 auth slice. The `session` table
 * already carries `impersonated_by` (no separate follow-up migration needed
 * for a fresh database).
 */
export const authModule: MigrationModule = {
  name: "auth",
  version: 1,
  contractVersion: 1,
  description: "user, session, account, verification, organization, member, invitation, user_source",
  dependencies: [],
  sql: `CREATE TYPE "public"."user_role" AS ENUM('user', 'admin', 'superadmin');
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
  "impersonated_by" uuid,
  CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
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
CREATE TABLE "verification" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
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
CREATE TABLE "member" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text DEFAULT 'member' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_member_org_user" UNIQUE("organization_id","user_id")
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
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_source" ADD CONSTRAINT "user_source_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_member_organization_id" ON "member" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "idx_member_user_id" ON "member" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "idx_invitation_organization_id" ON "invitation" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "idx_invitation_email" ON "invitation" USING btree ("email");
--> statement-breakpoint
CREATE INDEX "idx_user_source_user_id" ON "user_source" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "idx_user_source_aff_code" ON "user_source" USING btree ("aff_code");
--> statement-breakpoint
CREATE INDEX "idx_user_source_utm_source" ON "user_source" USING btree ("utm_source");
--> statement-breakpoint
CREATE INDEX "idx_user_source_country_code" ON "user_source" USING btree ("country_code");
--> statement-breakpoint
CREATE INDEX "idx_user_source_created_at" ON "user_source" USING btree ("created_at");`,
};
