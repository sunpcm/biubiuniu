/**
 * Commerce domain schema — PostgreSQL (Drizzle) physical model.
 *
 * Faithful reproduction of the N2 reference `apps/web/src/lib/db/schema.ts`
 * billing/credits slice: `orders`, `subscriptions`, `credit_balances`,
 * `organization_credit_balances`, and `credit_transactions`, plus the
 * `payment_provider`, `order_type`, `order_status`, `plan_interval`, and
 * `credit_transaction_type` enums. Export names, column names, types,
 * constraints, indexes, and FK semantics are preserved verbatim.
 *
 * `payment_provider` mirrors `@sunpcm/niu-contracts` `PaymentProvider`.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { PAYMENT_PROVIDERS, type PaymentProvider } from "@sunpcm/niu-contracts";
import { organization, user } from "./auth.js";

export const paymentProviderEnum = pgEnum(
  "payment_provider",
  PAYMENT_PROVIDERS as readonly [PaymentProvider, ...PaymentProvider[]],
);

export const orderTypeEnum = pgEnum("order_type", [
  "one_time",
  "subscription_initial",
  "subscription_renewal",
  "subscription_upgrade",
]);
export type OrderType = (typeof orderTypeEnum.enumValues)[number];

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "completed",
  "partially_refunded",
  "refunded",
  "failed",
]);
export type OrderStatus = (typeof orderStatusEnum.enumValues)[number];

export const planIntervalEnum = pgEnum("plan_interval", ["month", "year"]);
export type PlanInterval = (typeof planIntervalEnum.enumValues)[number];

export const creditTransactionTypeEnum = pgEnum("credit_transaction_type", [
  "purchase",
  "subscription_grant",
  "subscription_cycle_expire",
  "usage",
  "usage_refund",
  "refund_revoke",
  "subscription_end_revoke",
  "admin_adjustment",
  "signup_bonus",
]);
export type CreditTransactionType =
  (typeof creditTransactionTypeEnum.enumValues)[number];

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    organizationId: uuid("organization_id").references(
      () => organization.id,
      { onDelete: "set null" },
    ),
    planId: text("plan_id").notNull(),
    orderType: orderTypeEnum("order_type").notNull(),
    status: orderStatusEnum("status").default("completed").notNull(),
    creditsGranted: integer("credits_granted").default(0).notNull(),
    amountTotal: integer("amount_total").notNull(),
    amountSubtotal: integer("amount_subtotal"),
    amountDiscount: integer("amount_discount").default(0).notNull(),
    amountTax: integer("amount_tax").default(0).notNull(),
    amountRefunded: integer("amount_refunded").default(0).notNull(),
    currency: varchar("currency", { length: 10 }).notNull(),
    provider: paymentProviderEnum("provider").notNull(),
    providerOrderId: text("provider_order_id").notNull(),
    providerPaymentId: text("provider_payment_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userIdx: index("idx_orders_user_id").on(table.userId),
    organizationIdx: index("idx_orders_organization_id")
      .on(table.organizationId)
      .where(sql`${table.organizationId} is not null`),
    planIdIdx: index("idx_orders_plan_id").on(table.planId),
    createdAtIdx: index("idx_orders_created_at").on(table.createdAt),
    providerOrderUnique: uniqueIndex("uq_orders_provider_order_id").on(
      table.provider,
      table.providerOrderId,
    ),
    providerPaymentIdx: index("idx_orders_provider_payment_id").on(
      table.providerPaymentId,
    ),
    providerSubscriptionIdx: index(
      "idx_orders_provider_subscription_id",
    ).on(table.providerSubscriptionId),
  }),
);

export type OrderRow = typeof orders.$inferSelect;

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    organizationId: uuid("organization_id").references(
      () => organization.id,
      { onDelete: "restrict" },
    ),
    planId: text("plan_id").notNull(),
    provider: paymentProviderEnum("provider").notNull(),
    providerSubscriptionId: text("provider_subscription_id").notNull(),
    providerCustomerId: text("provider_customer_id"),
    providerPriceId: text("provider_price_id"),
    status: text("status").notNull(),
    interval: planIntervalEnum("interval").notNull(),
    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
    }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    monthlyCredits: integer("monthly_credits").default(0).notNull(),
    remainingGrants: integer("remaining_grants").default(0).notNull(),
    nextGrantAt: timestamp("next_grant_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userIdx: index("idx_subscriptions_user_id").on(table.userId),
    organizationIdx: index("idx_subscriptions_organization_id")
      .on(table.organizationId)
      .where(sql`${table.organizationId} is not null`),
    statusIdx: index("idx_subscriptions_status").on(table.status),
    planIdIdx: index("idx_subscriptions_plan_id").on(table.planId),
    providerSubscriptionUnique: uniqueIndex(
      "uq_subscriptions_provider_subscription_id",
    ).on(table.provider, table.providerSubscriptionId),
    nextGrantAtIdx: index("idx_subscriptions_next_grant_at")
      .on(table.nextGrantAt)
      .where(sql`${table.nextGrantAt} is not null`),
    currentPeriodEndIdx: index("idx_subscriptions_current_period_end")
      .on(table.currentPeriodEnd)
      .where(sql`${table.currentPeriodEnd} is not null`),
  }),
);

export type SubscriptionRow = typeof subscriptions.$inferSelect;

export const creditBalances = pgTable("credit_balances", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  subscriptionCredits: integer("subscription_credits").default(0).notNull(),
  purchasedCredits: integer("purchased_credits").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type CreditBalanceRow = typeof creditBalances.$inferSelect;

export const organizationCreditBalances = pgTable(
  "organization_credit_balances",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    subscriptionCredits: integer("subscription_credits").default(0).notNull(),
    purchasedCredits: integer("purchased_credits").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
);

export type OrganizationCreditBalanceRow =
  typeof organizationCreditBalances.$inferSelect;

export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    userId: uuid("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    organizationId: uuid("organization_id").references(
      () => organization.id,
      { onDelete: "restrict" },
    ),
    type: creditTransactionTypeEnum("type").notNull(),
    amount: integer("amount").notNull(),
    subscriptionDelta: integer("subscription_delta").default(0).notNull(),
    purchasedDelta: integer("purchased_delta").default(0).notNull(),
    subscriptionCreditsAfter: integer(
      "subscription_credits_after",
    ).notNull(),
    purchasedCreditsAfter: integer("purchased_credits_after").notNull(),
    note: text("note"),
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    refundedTransactionId: uuid("refunded_transaction_id")
      .unique()
      .references((): AnyPgColumn => creditTransactions.id, {
        onDelete: "set null",
      }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userCreatedAtIdx: index("idx_credit_transactions_user_created_at").on(
      table.userId,
      table.createdAt,
    ),
    organizationCreatedAtIdx: index(
      "idx_credit_transactions_org_created_at",
    )
      .on(table.organizationId, table.createdAt)
      .where(sql`${table.organizationId} is not null`),
    typeIdx: index("idx_credit_transactions_type").on(table.type),
    orderIdIdx: index("idx_credit_transactions_order_id").on(table.orderId),
  }),
);

export type CreditTransactionRow = typeof creditTransactions.$inferSelect;
