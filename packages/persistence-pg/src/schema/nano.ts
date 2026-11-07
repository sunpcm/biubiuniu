/**
 * Nano persistent-task schema — PostgreSQL (Drizzle) physical model.
 *
 * - `nano_tasks` is the append-only task/history log. Its `user_id` and
 *   `organization_id` are nullable with `ON DELETE SET NULL` so completed
 *   history never permanently blocks account/org deletion.
 * - `nano_active_jobs` holds one row per active (non-terminal) task with
 *   `ON DELETE RESTRICT` foreign keys to the owning subject, so deleting a user
 *   or org while a refundable task is active either rolls back or leaves a
 *   protected valid task.
 * - `nano_case_selections` records C06 case-selection events (not generation
 *   counts) with a 30-day product-scoped aggregation index.
 */
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth.js";
import { creditTransactions } from "./commerce.js";

export const nanoTaskStatusEnum = pgEnum("nano_task_status", [
  "queued",
  "leased",
  "dispatching",
  "running",
  "unknown",
  "succeeded",
  "failed",
  "canceled",
]);
export type NanoTaskStatus = (typeof nanoTaskStatusEnum.enumValues)[number];

export const nanoTasks = pgTable(
  "nano_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: text("product_id").notNull(),
    subjectKey: text("subject_key").notNull(),
    feature: text("feature").notNull(),
    requestKey: text("request_key").notNull(),
    contentSummary: text("content_summary").notNull(),
    status: nanoTaskStatusEnum("status").default("queued").notNull(),
    cost: integer("cost").notNull(),
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    organizationId: uuid("organization_id").references(
      () => organization.id,
      { onDelete: "set null" },
    ),
    spendTxId: uuid("spend_tx_id").references(() => creditTransactions.id, {
      onDelete: "set null",
    }),
    providerRequestKey: text("provider_request_key"),
    providerTaskId: text("provider_task_id"),
    resultRef: text("result_ref"),
    resultSummary: text("result_summary"),
    inputRef: jsonb("input_ref").$type<{
      prompt: string;
      imageData: string | null;
      mimeType: string | null;
    }>(),
    leaseOwner: text("lease_owner"),
    leaseToken: text("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    idempotencyUnique: uniqueIndex("uq_nano_tasks_idempotency").on(
      table.productId,
      table.subjectKey,
      table.feature,
      table.requestKey,
    ),
    statusIdx: index("idx_nano_tasks_status").on(table.status),
    leaseIdx: index("idx_nano_tasks_lease_until").on(table.leaseUntil),
    subjectKeyCreatedAtIdx: index("idx_nano_tasks_subject_created_at").on(
      table.subjectKey,
      table.createdAt,
    ),
  }),
);

export type NanoTaskRow = typeof nanoTasks.$inferSelect;

export const nanoActiveJobs = pgTable(
  "nano_active_jobs",
  {
    taskId: uuid("task_id")
      .primaryKey()
      .references(() => nanoTasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => user.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").references(
      () => organization.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userIdx: index("idx_nano_active_jobs_user").on(table.userId),
    organizationIdx: index("idx_nano_active_jobs_organization").on(
      table.organizationId,
    ),
  }),
);

export type NanoActiveJobRow = typeof nanoActiveJobs.$inferSelect;

export const nanoCaseSelections = pgTable(
  "nano_case_selections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: text("product_id").notNull(),
    caseId: text("case_id").notNull(),
    requestKey: text("request_key").notNull(),
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    selectedAt: timestamp("selected_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    idempotencyUnique: uniqueIndex("uq_nano_case_selections").on(
      table.productId,
      table.userId,
      table.requestKey,
    ),
    windowIdx: index("idx_nano_case_selections_window").on(
      table.productId,
      table.selectedAt,
    ),
  }),
);

export type NanoCaseSelectionRow = typeof nanoCaseSelections.$inferSelect;
