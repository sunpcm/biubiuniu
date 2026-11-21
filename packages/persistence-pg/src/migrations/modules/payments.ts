import type { MigrationModule } from "../types.js";

/**
 * Payments/billing module: orders and subscriptions.
 *
 * References `auth` (user and organization). Provider SDKs are not required to
 * create these tables; `provider` is a plain enum column.
 */
export const paymentsModule: MigrationModule = {
  name: "payments",
  version: 1,
  contractVersion: 1,
  description: "orders, subscriptions and billing enums",
  dependencies: ["auth"],
  sql: `CREATE TYPE "public"."payment_provider" AS ENUM('stripe', 'creem', 'paypal');
--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('one_time', 'subscription_initial', 'subscription_renewal', 'subscription_upgrade');
--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'completed', 'partially_refunded', 'refunded', 'failed');
--> statement-breakpoint
CREATE TYPE "public"."plan_interval" AS ENUM('month', 'year');
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
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_orders_user_id" ON "orders" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "idx_orders_organization_id" ON "orders" USING btree ("organization_id") WHERE "orders"."organization_id" is not null;
--> statement-breakpoint
CREATE INDEX "idx_orders_plan_id" ON "orders" USING btree ("plan_id");
--> statement-breakpoint
CREATE INDEX "idx_orders_created_at" ON "orders" USING btree ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_orders_provider_order_id" ON "orders" USING btree ("provider","provider_order_id");
--> statement-breakpoint
CREATE INDEX "idx_orders_provider_payment_id" ON "orders" USING btree ("provider_payment_id");
--> statement-breakpoint
CREATE INDEX "idx_orders_provider_subscription_id" ON "orders" USING btree ("provider_subscription_id");
--> statement-breakpoint
CREATE INDEX "idx_subscriptions_user_id" ON "subscriptions" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "idx_subscriptions_organization_id" ON "subscriptions" USING btree ("organization_id") WHERE "subscriptions"."organization_id" is not null;
--> statement-breakpoint
CREATE INDEX "idx_subscriptions_status" ON "subscriptions" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "idx_subscriptions_plan_id" ON "subscriptions" USING btree ("plan_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subscriptions_provider_subscription_id" ON "subscriptions" USING btree ("provider","provider_subscription_id");
--> statement-breakpoint
CREATE INDEX "idx_subscriptions_next_grant_at" ON "subscriptions" USING btree ("next_grant_at") WHERE "subscriptions"."next_grant_at" is not null;
--> statement-breakpoint
CREATE INDEX "idx_subscriptions_current_period_end" ON "subscriptions" USING btree ("current_period_end") WHERE "subscriptions"."current_period_end" is not null;`,
};
