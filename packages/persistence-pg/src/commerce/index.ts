import { AsyncLocalStorage } from "node:async_hooks";
import { and, asc, eq, gt, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { ENTITLED_SUBSCRIPTION_STATUSES } from "@sunpcm/niu-commerce";
import {
  creditBalances,
  creditTransactions,
  orders,
  organizationCreditBalances,
  subscriptions,
} from "../schema/commerce.js";
import { member, organization, user } from "../schema/auth.js";
import type {
  CommerceUnit,
  OrderDraft,
  OrderRow,
  SubscriptionDraft,
  SubscriptionRow,
} from "@sunpcm/niu-commerce";
import type {
  CanonicalSubscriptionStatus,
  CommerceStore,
  CreditSubject,
  PaymentProvider,
} from "@sunpcm/niu-commerce";

/**
 * PostgreSQL adapter for @sunpcm/niu-commerce.
 * Schema exports keep the N2 names. This file does not own the manifest,
 * migration, or schema modules. Domain decisions stay in the commerce package.
 */
type PgCommerceSchema = Record<string, unknown>;
type Database<TSchema extends PgCommerceSchema = PgCommerceSchema> = PostgresJsDatabase<TSchema>;
type Query<TSchema extends PgCommerceSchema = PgCommerceSchema> = Pick<
  Database<TSchema>,
  "select" | "insert" | "update" | "execute"
>;

const SUBSCRIPTION_ORDER_TYPES = ["subscription_initial", "subscription_renewal"] as const;

function subjectKey(
  subject: CreditSubject,
): { kind: "org"; id: string } | { kind: "user"; id: string } {
  if (subject.organizationId) return { kind: "org", id: subject.organizationId };
  if (!subject.userId) throw new Error("CreditSubject requires userId or organizationId");
  return { kind: "user", id: subject.userId };
}

function mapOrder(row: {
  id: string;
  userId: string | null;
  organizationId: string | null;
  planId: string;
  orderType: OrderRow["orderType"];
  status: OrderRow["status"];
  creditsGranted: number;
  amountTotal: number;
  amountSubtotal: number | null;
  amountDiscount: number;
  amountTax: number;
  amountRefunded: number;
  currency: string;
  provider: PaymentProvider;
  providerOrderId: string;
  providerPaymentId: string | null;
  providerSubscriptionId: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  refundedAt: Date | null;
}): OrderRow {
  return { ...row, metadata: (row.metadata as Record<string, unknown> | null) ?? null };
}

type StoredSubscriptionRow = typeof subscriptions.$inferSelect;

const CANONICAL_SUBSCRIPTION_STATUS = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  unpaid: "unpaid",
  canceled: "canceled",
  incomplete: "incomplete",
  expired: "expired",
  paused: "paused",
} as const satisfies { [Status in CanonicalSubscriptionStatus]: Status };

function isCanonicalSubscriptionStatus(status: string): status is CanonicalSubscriptionStatus {
  return Object.hasOwn(CANONICAL_SUBSCRIPTION_STATUS, status);
}

function requireCanonicalSubscriptionStatus(status: string): CanonicalSubscriptionStatus {
  if (isCanonicalSubscriptionStatus(status)) return status;
  throw new Error(
    `subscriptions.status is not a canonical subscription status: ${JSON.stringify(status)}`,
  );
}

function mapSubscription(row: StoredSubscriptionRow): SubscriptionRow {
  return {
    ...row,
    status: requireCanonicalSubscriptionStatus(row.status),
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  };
}

function customerColumn(provider: PaymentProvider) {
  if (provider === "stripe") return user.stripeCustomerId;
  if (provider === "creem") return user.creemCustomerId;
  return user.paypalPayerId;
}

/**
 * Root database or the caller's open Drizzle transaction.
 * Auth passes its compensation `tx` here. Only `select` is required, and the
 * type matches that handle without this module importing Auth.
 */
export type PgCommerceQueryable = Pick<Database, "select">;

export interface PgCommerceOrgSeatCap {
  seats: number;
  hasTeamSubscription: boolean;
}

export interface PgCommerceOrganizationDeletionBlockers {
  hasTeamSubscription: boolean;
  hasBillingHistory: boolean;
}

export interface PgCommerceBillingQueries {
  getOrgSeatCap(
    queryable: PgCommerceQueryable,
    organizationId: string,
  ): Promise<PgCommerceOrgSeatCap>;
  hasLivePersonalSubscription(queryable: PgCommerceQueryable, userId: string): Promise<boolean>;
  getOrganizationDeletionBlockers(
    queryable: PgCommerceQueryable,
    organizationId: string,
  ): Promise<PgCommerceOrganizationDeletionBlockers>;
}

function billingSelect(queryable: PgCommerceQueryable): Pick<Database, "select"> {
  if (!queryable || typeof queryable.select !== "function") {
    throw new Error("Commerce billing query requires the caller's database or transaction handle");
  }
  return queryable;
}

async function selectUserHasLiveSubscription(
  queryable: Pick<Database, "select">,
  userId: string,
  entitled: readonly string[],
): Promise<boolean> {
  const db = queryable;
  const [row] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, [...entitled])))
    .limit(1);
  return !!row;
}

async function selectLiveOrganizationPlan(
  queryable: Pick<Database, "select">,
  organizationId: string,
  entitled: readonly string[],
): Promise<{ planId: string; status: CanonicalSubscriptionStatus } | null> {
  const db = queryable;
  const [row] = await db
    .select({ planId: subscriptions.planId, status: subscriptions.status })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.organizationId, organizationId),
        inArray(subscriptions.status, [...entitled]),
      ),
    )
    .orderBy(sql`${subscriptions.createdAt} desc`)
    .limit(1);
  return row
    ? { planId: row.planId, status: requireCanonicalSubscriptionStatus(row.status) }
    : null;
}

async function selectOrganizationHasBillingHistory(
  queryable: Pick<Database, "select">,
  organizationId: string,
): Promise<boolean> {
  const db = queryable;
  const [sub] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId))
    .limit(1);
  if (sub) return true;
  const [ledger] = await db
    .select({ id: creditTransactions.id })
    .from(creditTransactions)
    .where(eq(creditTransactions.organizationId, organizationId))
    .limit(1);
  return !!ledger;
}

export function createPgCommerceBillingQueries(options: {
  seatCatalog: (planId: string | null | undefined) => number;
  entitled?: readonly CanonicalSubscriptionStatus[];
}): PgCommerceBillingQueries {
  if (typeof options?.seatCatalog !== "function") {
    throw new Error("Commerce billing queries require seatCatalog");
  }
  const entitled = options.entitled ?? ENTITLED_SUBSCRIPTION_STATUSES;
  return {
    async getOrgSeatCap(queryable, organizationId) {
      const db = billingSelect(queryable);
      const plan = await selectLiveOrganizationPlan(db, organizationId, entitled);
      return { seats: options.seatCatalog(plan?.planId), hasTeamSubscription: plan != null };
    },
    hasLivePersonalSubscription(queryable, userId) {
      return selectUserHasLiveSubscription(billingSelect(queryable), userId, entitled);
    },
    async getOrganizationDeletionBlockers(queryable, organizationId) {
      const db = billingSelect(queryable);
      const plan = await selectLiveOrganizationPlan(db, organizationId, entitled);
      const hasBillingHistory = await selectOrganizationHasBillingHistory(db, organizationId);
      return { hasTeamSubscription: plan != null, hasBillingHistory };
    },
  };
}

export function bindPgCommerceUnit<TSchema extends PgCommerceSchema>(
  db: Query<TSchema>,
): CommerceUnit {
  return openPgCommerceUnit(db, false);
}

function openPgCommerceUnit<TSchema extends PgCommerceSchema>(
  db: Query<TSchema>,
  owned: boolean,
): CommerceUnit {
  const permitWrite = () => {
    if (!owned) throw new Error("Commerce transaction does not belong to this instance");
  };
  return {
    balances: {
      async lock(subject) {
        permitWrite();
        const key = subjectKey(subject);
        if (key.kind === "org") {
          await db
            .insert(organizationCreditBalances)
            .values({ organizationId: key.id })
            .onConflictDoNothing();
          const [row] = await db
            .select({
              subscription: organizationCreditBalances.subscriptionCredits,
              purchased: organizationCreditBalances.purchasedCredits,
            })
            .from(organizationCreditBalances)
            .where(eq(organizationCreditBalances.organizationId, key.id))
            .for("update");
          return row ?? { subscription: 0, purchased: 0 };
        }
        await db.insert(creditBalances).values({ userId: key.id }).onConflictDoNothing();
        const [row] = await db
          .select({
            subscription: creditBalances.subscriptionCredits,
            purchased: creditBalances.purchasedCredits,
          })
          .from(creditBalances)
          .where(eq(creditBalances.userId, key.id))
          .for("update");
        return row ?? { subscription: 0, purchased: 0 };
      },
      async write(subject, next, at) {
        permitWrite();
        const values = {
          subscriptionCredits: next.subscription,
          purchasedCredits: next.purchased,
          updatedAt: at,
        };
        const key = subjectKey(subject);
        if (key.kind === "org") {
          await db
            .update(organizationCreditBalances)
            .set(values)
            .where(eq(organizationCreditBalances.organizationId, key.id));
          return;
        }
        await db.update(creditBalances).set(values).where(eq(creditBalances.userId, key.id));
      },
      async read(subject) {
        const key = subjectKey(subject);
        if (key.kind === "org") {
          const [row] = await db
            .select({
              subscription: organizationCreditBalances.subscriptionCredits,
              purchased: organizationCreditBalances.purchasedCredits,
            })
            .from(organizationCreditBalances)
            .where(eq(organizationCreditBalances.organizationId, key.id));
          return row ?? { subscription: 0, purchased: 0 };
        }
        const [row] = await db
          .select({
            subscription: creditBalances.subscriptionCredits,
            purchased: creditBalances.purchasedCredits,
          })
          .from(creditBalances)
          .where(eq(creditBalances.userId, key.id));
        return row ?? { subscription: 0, purchased: 0 };
      },
    },
    ledger: {
      async append(entry) {
        permitWrite();
        const [row] = await db
          .insert(creditTransactions)
          .values({
            userId: entry.userId,
            organizationId: entry.organizationId,
            type: entry.type,
            amount: entry.amount,
            subscriptionDelta: entry.subscriptionDelta,
            purchasedDelta: entry.purchasedDelta,
            subscriptionCreditsAfter: entry.subscriptionCreditsAfter,
            purchasedCreditsAfter: entry.purchasedCreditsAfter,
            note: entry.note ?? null,
            orderId: entry.orderId ?? null,
            refundedTransactionId: entry.refundedTransactionId ?? null,
            createdAt: entry.createdAt,
          })
          .returning({ id: creditTransactions.id });
        if (!row) throw new Error("Credit ledger insert did not return an id");
        return row;
      },
      async findUsage(id) {
        const [row] = await db
          .select({
            userId: creditTransactions.userId,
            organizationId: creditTransactions.organizationId,
            subscriptionDelta: creditTransactions.subscriptionDelta,
            purchasedDelta: creditTransactions.purchasedDelta,
          })
          .from(creditTransactions)
          .where(and(eq(creditTransactions.id, id), eq(creditTransactions.type, "usage")))
          .limit(1);
        return row ?? null;
      },
      async findRefundOf(spendTxId) {
        const [row] = await db
          .select({ id: creditTransactions.id })
          .from(creditTransactions)
          .where(eq(creditTransactions.refundedTransactionId, spendTxId))
          .limit(1);
        return row ?? null;
      },
      async hasSignupBonus(userId) {
        const [row] = await db
          .select({ id: creditTransactions.id })
          .from(creditTransactions)
          .where(
            and(eq(creditTransactions.userId, userId), eq(creditTransactions.type, "signup_bonus")),
          )
          .limit(1);
        return !!row;
      },
      async sumSubscriptionGrantsSince(subject, since) {
        const key = subjectKey(subject);
        const predicate =
          key.kind === "org"
            ? eq(creditTransactions.organizationId, key.id)
            : and(eq(creditTransactions.userId, key.id), isNull(creditTransactions.organizationId));
        const [row] = await db
          .select({
            total: sql<number>`coalesce(sum(${creditTransactions.subscriptionDelta}), 0)::int`,
          })
          .from(creditTransactions)
          .where(
            and(
              predicate,
              eq(creditTransactions.type, "subscription_grant"),
              gte(creditTransactions.createdAt, since),
            ),
          );
        return row?.total ?? 0;
      },
    },
    orders: {
      async insertIfAbsent(draft: OrderDraft) {
        permitWrite();
        const [row] = await db
          .insert(orders)
          .values(draft)
          .onConflictDoNothing({ target: [orders.provider, orders.providerOrderId] })
          .returning({ id: orders.id });
        return row ?? null;
      },
      async lockById(id) {
        permitWrite();
        const [row] = await db
          .select()
          .from(orders)
          .where(eq(orders.id, id))
          .for("update")
          .limit(1);
        return row ? mapOrder(row) : null;
      },
      async findByProviderOrder(provider, providerOrderId) {
        const [row] = await db
          .select()
          .from(orders)
          .where(and(eq(orders.provider, provider), eq(orders.providerOrderId, providerOrderId)))
          .limit(1);
        return row ? mapOrder(row) : null;
      },
      async lockByProviderOrder(provider, providerOrderId) {
        permitWrite();
        const [row] = await db
          .select()
          .from(orders)
          .where(and(eq(orders.provider, provider), eq(orders.providerOrderId, providerOrderId)))
          .for("update")
          .limit(1);
        return row ? mapOrder(row) : null;
      },
      async findFirstByProviderPayment(provider, providerPaymentId) {
        const [row] = await db
          .select()
          .from(orders)
          .where(
            and(eq(orders.provider, provider), eq(orders.providerPaymentId, providerPaymentId)),
          )
          .limit(1);
        return row ? mapOrder(row) : null;
      },
      async update(id, patch) {
        permitWrite();
        await db.update(orders).set(patch).where(eq(orders.id, id));
      },
      async listBySubscription(provider, providerSubscriptionId) {
        const rows = await db
          .select()
          .from(orders)
          .where(
            and(
              eq(orders.provider, provider),
              eq(orders.providerSubscriptionId, providerSubscriptionId),
            ),
          );
        return rows.map(mapOrder);
      },
      async listPayPalBindings(orderId, captureId) {
        const keys = [];
        if (orderId)
          keys.push(
            eq(orders.providerOrderId, orderId),
            sql`${orders.metadata}->>'paypalOrderId' = ${orderId}`,
          );
        if (captureId)
          keys.push(eq(orders.providerOrderId, captureId), eq(orders.providerPaymentId, captureId));
        if (!keys.length) return [];
        const rows = await db
          .select()
          .from(orders)
          .where(and(eq(orders.provider, "paypal"), eq(orders.orderType, "one_time"), or(...keys)))
          .limit(2);
        return rows.map(mapOrder);
      },
      async listPendingPayPal(cutoff, limit) {
        const rows = await db
          .select()
          .from(orders)
          .where(
            and(
              eq(orders.provider, "paypal"),
              eq(orders.orderType, "one_time"),
              eq(orders.status, "pending"),
              lte(orders.createdAt, cutoff),
              lte(orders.updatedAt, cutoff),
            ),
          )
          .orderBy(asc(orders.createdAt))
          .limit(limit);
        return rows.map(mapOrder);
      },
      async touch(id, at) {
        permitWrite();
        await db.update(orders).set({ updatedAt: at }).where(eq(orders.id, id));
      },
      async markPendingFailed(provider, captureId, at) {
        permitWrite();
        await db
          .update(orders)
          .set({ status: "failed", updatedAt: at })
          .where(
            and(
              eq(orders.provider, provider),
              eq(orders.status, "pending"),
              or(eq(orders.providerOrderId, captureId), eq(orders.providerPaymentId, captureId)),
            ),
          );
      },
    },
    subscriptions: {
      async upsert(row: SubscriptionDraft, preserveTerminal: boolean) {
        permitWrite();
        const values = {
          userId: row.userId,
          organizationId: row.organizationId,
          planId: row.planId,
          providerCustomerId: row.providerCustomerId,
          providerPriceId: row.providerPriceId,
          status: row.status,
          interval: row.interval,
          currentPeriodStart: row.currentPeriodStart,
          currentPeriodEnd: row.currentPeriodEnd,
          cancelAtPeriodEnd: row.cancelAtPeriodEnd,
          canceledAt: row.canceledAt,
          endedAt: row.endedAt,
          monthlyCredits: row.monthlyCredits,
          updatedAt: row.updatedAt,
          ...(row.metadata !== undefined ? { metadata: row.metadata } : {}),
        };
        await db
          .insert(subscriptions)
          .values({
            ...values,
            provider: row.provider,
            providerSubscriptionId: row.providerSubscriptionId,
            remainingGrants: 0,
            nextGrantAt: null,
          })
          .onConflictDoUpdate({
            target: [subscriptions.provider, subscriptions.providerSubscriptionId],
            set: values,
            ...(preserveTerminal
              ? { setWhere: sql`${subscriptions.status} not in ('canceled', 'expired')` }
              : {}),
          });
      },
      async findByKey(provider, providerSubscriptionId) {
        const [row] = await db
          .select()
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.provider, provider),
              eq(subscriptions.providerSubscriptionId, providerSubscriptionId),
            ),
          )
          .limit(1);
        return row ? mapSubscription(row) : null;
      },
      async lockByKey(provider, providerSubscriptionId) {
        permitWrite();
        const [row] = await db
          .select()
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.provider, provider),
              eq(subscriptions.providerSubscriptionId, providerSubscriptionId),
            ),
          )
          .for("update")
          .limit(1);
        return row ? mapSubscription(row) : null;
      },
      async findByLocalId(id) {
        const [row] = await db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.id, id))
          .limit(1);
        return row ? mapSubscription(row) : null;
      },
      async lockByLocalId(id) {
        permitWrite();
        const [row] = await db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.id, id))
          .for("update")
          .limit(1);
        return row ? mapSubscription(row) : null;
      },
      async update(provider, providerSubscriptionId, patch) {
        permitWrite();
        await db
          .update(subscriptions)
          .set(patch)
          .where(
            and(
              eq(subscriptions.provider, provider),
              eq(subscriptions.providerSubscriptionId, providerSubscriptionId),
            ),
          );
      },
      async advisoryLockSubject(key) {
        permitWrite();
        await db.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
      },
      async listBySubject(subject) {
        const predicate = subject.organizationId
          ? eq(subscriptions.organizationId, subject.organizationId)
          : subject.userId
            ? and(eq(subscriptions.userId, subject.userId), isNull(subscriptions.organizationId))
            : null;
        if (!predicate) return [];
        const rows = await db.select().from(subscriptions).where(predicate);
        return rows.map(mapSubscription);
      },
      async listDueDrips(now, subject, limit) {
        const filters = [
          gt(subscriptions.remainingGrants, 0),
          lte(subscriptions.nextGrantAt, now),
          inArray(subscriptions.status, ["active", "trialing"]),
        ];
        if (subject?.organizationId)
          filters.push(eq(subscriptions.organizationId, subject.organizationId));
        else if (subject?.userId)
          filters.push(
            and(eq(subscriptions.userId, subject.userId), isNull(subscriptions.organizationId))!,
          );
        const query = db
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(and(...filters))
          .orderBy(asc(subscriptions.nextGrantAt));
        const rows = limit ? await query.limit(limit) : await query;
        return rows;
      },
      async listOverdueRenewals(providers, cutoff, limit) {
        const rows = await db
          .select()
          .from(subscriptions)
          .where(
            and(
              inArray(subscriptions.provider, providers),
              lte(subscriptions.currentPeriodEnd, cutoff),
              lte(subscriptions.updatedAt, cutoff),
              inArray(subscriptions.status, ["active", "trialing", "past_due"]),
            ),
          )
          .orderBy(asc(subscriptions.currentPeriodEnd))
          .limit(limit);
        return rows.map(mapSubscription);
      },
      async touch(id, at) {
        permitWrite();
        await db.update(subscriptions).set({ updatedAt: at }).where(eq(subscriptions.id, id));
      },
      async hasEntitledForUser(userId, entitled) {
        const memberOrgIds = db
          .select({ organizationId: member.organizationId })
          .from(member)
          .where(eq(member.userId, userId));
        const [row] = await db
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(
            and(
              inArray(subscriptions.status, [...entitled]),
              or(
                and(eq(subscriptions.userId, userId), isNull(subscriptions.organizationId)),
                inArray(subscriptions.organizationId, memberOrgIds),
              ),
            ),
          )
          .limit(1);
        return !!row;
      },
      async findLatestEntitled(subject, entitled) {
        const predicate = subject.organizationId
          ? eq(subscriptions.organizationId, subject.organizationId)
          : subject.userId
            ? and(eq(subscriptions.userId, subject.userId), isNull(subscriptions.organizationId))
            : null;
        if (!predicate) return null;
        const [row] = await db
          .select()
          .from(subscriptions)
          .where(and(predicate, inArray(subscriptions.status, [...entitled])))
          .orderBy(sql`${subscriptions.createdAt} desc`)
          .limit(1);
        return row ? mapSubscription(row) : null;
      },
      async hasOtherLive(subject, exceptId, entitled) {
        const predicate = subject.organizationId
          ? eq(subscriptions.organizationId, subject.organizationId)
          : subject.userId
            ? and(eq(subscriptions.userId, subject.userId), isNull(subscriptions.organizationId))
            : null;
        if (!predicate) return false;
        const [row] = await db
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(
            and(
              predicate,
              ne(subscriptions.id, exceptId),
              inArray(subscriptions.status, [...entitled]),
            ),
          )
          .limit(1);
        return !!row;
      },
      async countOtherSubscriptionOrders(provider, providerSubscriptionId, exceptProviderOrderId) {
        const rows = await db
          .select({ id: orders.id })
          .from(orders)
          .where(
            and(
              eq(orders.provider, provider),
              eq(orders.providerSubscriptionId, providerSubscriptionId),
              inArray(orders.orderType, [...SUBSCRIPTION_ORDER_TYPES]),
              ne(orders.providerOrderId, exceptProviderOrderId),
            ),
          )
          .limit(1);
        return rows.length;
      },
    },
    billing: {
      userHasLiveSubscription(userId, entitled) {
        return selectUserHasLiveSubscription(db, userId, entitled);
      },
      findLiveOrganizationPlan(organizationId, entitled) {
        return selectLiveOrganizationPlan(db, organizationId, entitled);
      },
      organizationHasBillingHistory(organizationId) {
        return selectOrganizationHasBillingHistory(db, organizationId);
      },
    },
    identity: {
      async findLivingUserId(id) {
        const [row] = await db.select({ id: user.id }).from(user).where(eq(user.id, id)).limit(1);
        return row?.id ?? null;
      },
      async findLivingOrganizationId(id) {
        const [row] = await db
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.id, id))
          .limit(1);
        return row?.id ?? null;
      },
      async isLiveMember(userId, organizationId) {
        const [row] = await db
          .select({ id: member.id })
          .from(member)
          .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
          .limit(1);
        return !!row;
      },
      async findUserIdByProviderCustomer(provider, customerId) {
        const column = customerColumn(provider);
        const [row] = await db
          .select({ id: user.id })
          .from(user)
          .where(eq(column, customerId))
          .limit(1);
        return row?.id ?? null;
      },
      async readProviderCustomer(userId, provider) {
        const column = customerColumn(provider);
        const [row] = await db
          .select({ current: column })
          .from(user)
          .where(eq(user.id, userId))
          .limit(1);
        return row?.current ?? null;
      },
      async writeProviderCustomerIfAbsent(userId, provider, customerId, at) {
        permitWrite();
        const column = customerColumn(provider);
        const [row] = await db
          .select({ current: column })
          .from(user)
          .where(eq(user.id, userId))
          .limit(1);
        if (!row) return "missing";
        if (row.current === customerId) return "same";
        if (row.current) return "conflict";
        await db
          .update(user)
          .set({
            [provider === "stripe"
              ? "stripeCustomerId"
              : provider === "creem"
                ? "creemCustomerId"
                : "paypalPayerId"]: customerId,
            updatedAt: at,
          })
          .where(and(eq(user.id, userId), isNull(column)));
        return "written";
      },
      async findUserEmail(userId) {
        const [row] = await db
          .select({ email: user.email })
          .from(user)
          .where(eq(user.id, userId))
          .limit(1);
        return row?.email ?? null;
      },
    },
  };
}

export type PgCommerceHandle = Pick<
  Database,
  "select" | "insert" | "update" | "delete" | "execute"
>;

export interface PgCommerceWork {
  /** Drizzle handle of the open transaction. Never pass this into commerce core. */
  handle: PgCommerceHandle;
  unit: CommerceUnit;
}

export interface PgCommerceCoordinator {
  runtime: {
    deps: { store: CommerceStore };
    flushOuter(unit: CommerceUnit): void;
    discardOuter(unit: CommerceUnit): void;
  };
}

export interface PgCommerceStore extends CommerceStore {
  /**
   * Open one transaction on this store's database and bind its unit.
   * The handle is the Drizzle transaction this call opened. It is not a way
   * to register a root database, another database, or another store's
   * transaction. Commit flushes post-commit work; rollback discards it.
   */
  coordinate<T>(
    commerce: PgCommerceCoordinator,
    run: (work: PgCommerceWork) => Promise<T>,
  ): Promise<T>;
}

const OPEN_TRANSACTION =
  "Refusing to open another commerce transaction while one is active; use commerce.join(unit)";

export function createPgCommerceStore<TSchema extends PgCommerceSchema>(
  db: Database<TSchema>,
): PgCommerceStore {
  const open = new WeakSet<CommerceUnit>();
  const active = new AsyncLocalStorage<CommerceUnit>();
  const store: PgCommerceStore = {
    async transaction(run, outer) {
      if (outer) {
        if (!open.has(outer))
          throw new Error("Commerce transaction does not belong to this instance");
        return run(outer);
      }
      if (active.getStore()) throw new Error(OPEN_TRANSACTION);
      return db.transaction(async (tx) => {
        const unit = openPgCommerceUnit(tx, true);
        open.add(unit);
        try {
          return await active.run(unit, () => run(unit));
        } finally {
          open.delete(unit);
        }
      });
    },
    async coordinate(commerce, run) {
      if (commerce.runtime.deps.store !== store) {
        throw new Error(
          "coordinatePgCommerce requires the PG store injected into this commerce instance",
        );
      }
      if (active.getStore()) throw new Error(OPEN_TRANSACTION);
      let unit: CommerceUnit | undefined;
      let committed = false;
      try {
        const result = await db.transaction(async (tx) => {
          const bound = openPgCommerceUnit(tx, true);
          unit = bound;
          open.add(bound);
          try {
            return await active.run(bound, () => run({ handle: tx, unit: bound }));
          } finally {
            open.delete(bound);
          }
        });
        committed = true;
        if (unit) commerce.runtime.flushOuter(unit);
        return result;
      } catch (error) {
        if (unit && !committed) commerce.runtime.discardOuter(unit);
        throw error;
      }
    },
  };
  return store;
}

/** Same-transaction entry for N4. `store` must be the instance injected into `commerce`. */
export function coordinatePgCommerce<T>(
  store: PgCommerceStore,
  commerce: PgCommerceCoordinator,
  run: (work: PgCommerceWork) => Promise<T>,
): Promise<T> {
  return store.coordinate(commerce, run);
}
