import type { MigrationModule } from "../types.js";

/**
 * Credits module: two-bucket balances plus the append-only ledger.
 *
 * References `auth` (user and organization) and `payments` (the ledger's
 * `order_id` foreign key points at `orders.id`). The domain-level "payments
 * depend on credits" relationship is a service-orchestration contract (the
 * commerce store writes both in one transaction); at the FK level the ledger
 * physically depends on `orders`, which the planner validates here.
 */
export const creditsModule: MigrationModule = {
  name: "credits",
  version: 1,
  contractVersion: 1,
  description: "credit_balances, organization_credit_balances, credit_transactions",
  dependencies: ["auth", "payments"],
  sql: `CREATE TYPE "public"."credit_transaction_type" AS ENUM('purchase', 'subscription_grant', 'subscription_cycle_expire', 'usage', 'usage_refund', 'refund_revoke', 'subscription_end_revoke', 'admin_adjustment', 'signup_bonus');
--> statement-breakpoint
CREATE TABLE "credit_balances" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "subscription_credits" integer DEFAULT 0 NOT NULL,
  "purchased_credits" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_credit_balances" ADD CONSTRAINT "organization_credit_balances_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_refunded_transaction_id_credit_transactions_id_fk" FOREIGN KEY ("refunded_transaction_id") REFERENCES "public"."credit_transactions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_credit_transactions_user_created_at" ON "credit_transactions" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX "idx_credit_transactions_org_created_at" ON "credit_transactions" USING btree ("organization_id","created_at") WHERE "credit_transactions"."organization_id" is not null;
--> statement-breakpoint
CREATE INDEX "idx_credit_transactions_type" ON "credit_transactions" USING btree ("type");
--> statement-breakpoint
CREATE INDEX "idx_credit_transactions_order_id" ON "credit_transactions" USING btree ("order_id");`,
};
