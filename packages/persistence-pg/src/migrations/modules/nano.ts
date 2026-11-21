import type { MigrationModule } from "../types.js";

/**
 * Nano persistent-task module.
 *
 * References `auth` (user/organization) and `credits` (the spend ledger's
 * `credit_transactions.id` for the `spend_tx_id` association). Active jobs
 * carry `ON DELETE RESTRICT` subject foreign keys so a refundable task cannot
 * be orphaned by account/org deletion; terminal history uses nullable subjects.
 */
export const nanoModule: MigrationModule = {
  name: "nano",
  version: 1,
  contractVersion: 1,
  description: "nano_tasks, nano_active_jobs, nano_case_selections",
  dependencies: ["auth", "credits"],
  sql: `CREATE TYPE "public"."nano_task_status" AS ENUM('queued', 'leased', 'dispatching', 'running', 'unknown', 'succeeded', 'failed', 'canceled');
--> statement-breakpoint
CREATE TABLE "nano_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" text NOT NULL,
  "subject_key" text NOT NULL,
  "feature" text NOT NULL,
  "request_key" text NOT NULL,
  "content_summary" text NOT NULL,
  "status" "nano_task_status" DEFAULT 'queued' NOT NULL,
  "cost" integer NOT NULL,
  "user_id" uuid,
  "organization_id" uuid,
  "spend_tx_id" uuid,
  "provider_request_key" text,
  "provider_task_id" text,
  "result_ref" text,
  "result_summary" text,
  "input_ref" jsonb,
  "lease_owner" text,
  "lease_token" text,
  "lease_until" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nano_active_jobs" (
  "task_id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid,
  "organization_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nano_case_selections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" text NOT NULL,
  "case_id" text NOT NULL,
  "request_key" text NOT NULL,
  "user_id" uuid,
  "selected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nano_tasks" ADD CONSTRAINT "nano_tasks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "nano_tasks" ADD CONSTRAINT "nano_tasks_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "nano_tasks" ADD CONSTRAINT "nano_tasks_spend_tx_id_credit_transactions_id_fk" FOREIGN KEY ("spend_tx_id") REFERENCES "public"."credit_transactions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "nano_active_jobs" ADD CONSTRAINT "nano_active_jobs_task_id_nano_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."nano_tasks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "nano_active_jobs" ADD CONSTRAINT "nano_active_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "nano_active_jobs" ADD CONSTRAINT "nano_active_jobs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "nano_case_selections" ADD CONSTRAINT "nano_case_selections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_nano_tasks_idempotency" ON "nano_tasks" USING btree ("product_id","subject_key","feature","request_key");
--> statement-breakpoint
CREATE INDEX "idx_nano_tasks_status" ON "nano_tasks" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "idx_nano_tasks_lease_until" ON "nano_tasks" USING btree ("lease_until");
--> statement-breakpoint
CREATE INDEX "idx_nano_tasks_subject_created_at" ON "nano_tasks" USING btree ("subject_key","created_at");
--> statement-breakpoint
CREATE INDEX "idx_nano_active_jobs_user" ON "nano_active_jobs" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "idx_nano_active_jobs_organization" ON "nano_active_jobs" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_nano_case_selections" ON "nano_case_selections" USING btree ("product_id","user_id","request_key");
--> statement-breakpoint
CREATE INDEX "idx_nano_case_selections_window" ON "nano_case_selections" USING btree ("product_id","selected_at");`,
};
