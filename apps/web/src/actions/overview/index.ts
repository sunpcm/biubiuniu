/**
 * [INPUT]: Depends on @/lib/db and the orders/subscriptions/user/userSource/
 *          creditTransactions/feedback tables of schema, @/config/pricing's
 *          activePricingPlans/getPlanById/isSubscriptionPlan, @/lib/auth/server's
 *          isAdmin, ./range's resolveWindow/utcDayKey
 * [OUTPUT]: exports getOverviewKpis / getOverviewTrend / getOverviewBreakdowns /
 *           getOverviewAttention / getRecentOrders and their result types
 * [POS]: actions/overview — sole data source of the admin overview page, read-only
 *        aggregates with no write path; the five entry points map one-to-one onto
 *        the page's five Suspense sections, each streaming independently
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

'use server'

import {
  activePricingPlans,
  getPlanById,
  isSubscriptionPlan,
  type PaymentProvider,
} from '@/config/pricing'
import { actionResponse, type ActionResult } from '@/lib/action-response'
import { isAdmin } from '@/lib/auth/server'
import { db } from '@/lib/db'
import {
  creditTransactions,
  feedback,
  orders,
  subscriptions,
  user,
  userSource,
  type OrderStatus,
  type OrderType,
} from '@/lib/db/schema'
import { getErrorMessage } from '@/lib/error-utils'
import { and, count, desc, eq, gte, inArray, or, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { DAY_MS, resolveWindow, utcDayKey, type OverviewRange } from './range'

// ────────────────────────────────────────────────────────────────
//  Conventions (uniform across the page)
//  - Amounts: integer cents; net = amount_total - amount_refunded (a refund
//    rewrites the original order, so there are no refund rows to special-case).
//  - Settled orders = completed / partially_refunded / refunded; pending
//    (in flight) and failed (bounced) are audit-trail rows: no revenue, no sale.
//  - Reporting currency: the currency of the first active plan in the pricing
//    config (USD by default in this template). Money metrics aggregate only
//    that currency; orders in other currencies are not FX-converted but
//    surfaced as a count under "needs attention" — better to under-count than
//    to mix currencies.
//  - Signups: anonymous accounts excluded (Better Auth anonymous plugin).
//  - Credit burn: the absolute value of usage minus usage_refund give-backs,
//    i.e. net consumption.
//  - MRR: active + past_due subscriptions converted to a monthly rate at the
//    configured price (yearly / 12); trialing is counted separately and does
//    not enter MRR.
//  - Churn: subscriptions entering the terminal canceled / expired state
//    within this window.
// ────────────────────────────────────────────────────────────────

const REPORTING_CURRENCY = (activePricingPlans[0]?.currency ?? 'USD').toUpperCase()

const SETTLED_STATUSES: OrderStatus[] = ['completed', 'partially_refunded', 'refunded']

const MRR_STATUSES = ['active', 'past_due'] as const
const AT_RISK_STATUSES = ['past_due', 'unpaid'] as const

const netAmount = sql`${orders.amountTotal} - ${orders.amountRefunded}`
const inReportingCurrency = sql`upper(${orders.currency}) = ${REPORTING_CURRENCY}`

/** SUM(expr) FILTER (WHERE cond) → number; an empty set folds to zero */
const sumWhere = (expr: SQL, cond: SQL) =>
  sql`COALESCE(SUM(${expr}) FILTER (WHERE ${cond}), 0)`.mapWith(Number)

/**
 * A Date inside a raw sql template is serialized by the driver via toString()
 * (timezone name included — Postgres cannot parse it); drizzle's column
 * comparisons (gte etc.) convert to ISO through the column mapping, so inside
 * a template the conversion has to be done by hand.
 */
const ts = (date: Date) => sql`${date.toISOString()}::timestamptz`

/** COUNT(*) FILTER (WHERE cond) → number */
const countWhere = (cond: SQL) => sql`COUNT(*) FILTER (WHERE ${cond})`.mapWith(Number)

/** UTC calendar-day key, aligned with range.ts's utcDayKey */
const dayKey = (column: AnyPgColumn) =>
  sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`

async function requireAdmin(): Promise<ActionResult<never> | null> {
  return (await isAdmin()) ? null : actionResponse.forbidden('Admin privileges required.')
}

// ────────────────────────────────────────────────────────────────
//  1. KPI cards — current window vs. comparison window
// ────────────────────────────────────────────────────────────────

/** A metric's value in the current and comparison windows; the UI computes the delta */
export interface Delta {
  current: number
  previous: number
}

export interface OverviewKpis {
  currency: string
  /** Net revenue (cents) */
  revenue: Delta
  /** Refunds issued within this window (cents) */
  refunds: number
  /** Settled order count (any currency) */
  orders: Delta
  signups: Delta
  totalUsers: number
  /** Net credits consumed */
  creditsConsumed: Delta
  /** Distinct users with usage records */
  activeUsers: Delta
  mrr: {
    cents: number
    subscribers: number
    trialing: number
    /** Subscriptions created in this window */
    added: number
    /** Subscriptions entering a terminal state in this window */
    churned: number
  }
}

export const getOverviewKpis = async (
  range: OverviewRange
): Promise<ActionResult<OverviewKpis>> => {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const w = resolveWindow(range)
    const inCurrent = sql`${orders.createdAt} >= ${ts(w.start)}`
    const inPrevious = sql`${orders.createdAt} >= ${ts(w.prevStart)} AND ${orders.createdAt} < ${ts(w.start)}`

    const [[orderRow], [userRow], [creditRow], mrrRows, [movementRow]] = await Promise.all([
      db
        .select({
          revenueCurrent: sumWhere(netAmount, sql`${inCurrent} AND ${inReportingCurrency}`),
          revenuePrevious: sumWhere(netAmount, sql`${inPrevious} AND ${inReportingCurrency}`),
          refunds: sumWhere(
            sql`${orders.amountRefunded}`,
            sql`${orders.refundedAt} >= ${ts(w.start)} AND ${inReportingCurrency}`
          ),
          ordersCurrent: countWhere(inCurrent),
          ordersPrevious: countWhere(inPrevious),
        })
        .from(orders)
        .where(
          and(
            inArray(orders.status, SETTLED_STATUSES),
            or(gte(orders.createdAt, w.prevStart), gte(orders.refundedAt, w.start))
          )
        ),
      db
        .select({
          total: count(),
          current: countWhere(sql`${user.createdAt} >= ${ts(w.start)}`),
          previous: countWhere(
            sql`${user.createdAt} >= ${ts(w.prevStart)} AND ${user.createdAt} < ${ts(w.start)}`
          ),
        })
        .from(user)
        .where(eq(user.isAnonymous, false)),
      db
        .select({
          consumedCurrent: sumWhere(
            sql`-${creditTransactions.amount}`,
            sql`${creditTransactions.createdAt} >= ${ts(w.start)}`
          ),
          consumedPrevious: sumWhere(
            sql`-${creditTransactions.amount}`,
            sql`${creditTransactions.createdAt} < ${ts(w.start)}`
          ),
          activeCurrent: sql`COUNT(DISTINCT ${creditTransactions.userId}) FILTER (WHERE ${creditTransactions.type} = 'usage' AND ${creditTransactions.createdAt} >= ${ts(w.start)})`.mapWith(
            Number
          ),
          activePrevious: sql`COUNT(DISTINCT ${creditTransactions.userId}) FILTER (WHERE ${creditTransactions.type} = 'usage' AND ${creditTransactions.createdAt} < ${ts(w.start)})`.mapWith(
            Number
          ),
        })
        .from(creditTransactions)
        .where(
          and(
            gte(creditTransactions.createdAt, w.prevStart),
            inArray(creditTransactions.type, ['usage', 'usage_refund'])
          )
        ),
      db
        .select({
          planId: subscriptions.planId,
          status: subscriptions.status,
          count: count(),
        })
        .from(subscriptions)
        .where(inArray(subscriptions.status, [...MRR_STATUSES, 'trialing']))
        .groupBy(subscriptions.planId, subscriptions.status),
      db
        .select({
          added: countWhere(sql`${subscriptions.createdAt} >= ${ts(w.start)}`),
          churned: countWhere(
            sql`${subscriptions.status} IN ('canceled', 'expired') AND COALESCE(${subscriptions.endedAt}, ${subscriptions.canceledAt}) >= ${ts(w.start)}`
          ),
        })
        .from(subscriptions)
        .where(
          or(
            gte(subscriptions.createdAt, w.start),
            gte(subscriptions.endedAt, w.start),
            gte(subscriptions.canceledAt, w.start)
          )
        ),
    ])

    // MRR: convert each plan's configured price to a monthly rate. Retired slugs
    // stay in the config (iron rule: never physically deleted); a subscription
    // whose plan is missing or priced in another currency counts as a head only,
    // never as an amount.
    let mrrCents = 0
    let subscribers = 0
    let trialing = 0
    for (const row of mrrRows) {
      if (row.status === 'trialing') {
        trialing += row.count
        continue
      }
      subscribers += row.count
      const plan = getPlanById(row.planId)
      if (!plan || !isSubscriptionPlan(plan)) continue
      if (plan.currency.toUpperCase() !== REPORTING_CURRENCY) continue
      const monthlyCents = Math.round((plan.price * 100) / (plan.interval === 'year' ? 12 : 1))
      mrrCents += monthlyCents * row.count
    }

    return actionResponse.success({
      currency: REPORTING_CURRENCY,
      revenue: { current: orderRow.revenueCurrent, previous: orderRow.revenuePrevious },
      refunds: orderRow.refunds,
      orders: { current: orderRow.ordersCurrent, previous: orderRow.ordersPrevious },
      signups: { current: userRow.current, previous: userRow.previous },
      totalUsers: userRow.total,
      creditsConsumed: {
        current: creditRow.consumedCurrent,
        previous: creditRow.consumedPrevious,
      },
      activeUsers: { current: creditRow.activeCurrent, previous: creditRow.activePrevious },
      mrr: {
        cents: mrrCents,
        subscribers,
        trialing,
        added: movementRow.added,
        churned: movementRow.churned,
      },
    })
  } catch (error) {
    return actionResponse.error(getErrorMessage(error))
  }
}

// ────────────────────────────────────────────────────────────────
//  2. Trend — day-by-day series over the current window, missing days zero-filled
// ────────────────────────────────────────────────────────────────

export interface TrendPoint {
  /** 'YYYY-MM-DD' (UTC) */
  date: string
  /** Net revenue (cents) */
  revenue: number
  signups: number
  orders: number
  creditsConsumed: number
}

export interface OverviewTrend {
  currency: string
  points: TrendPoint[]
}

export const getOverviewTrend = async (
  range: OverviewRange
): Promise<ActionResult<OverviewTrend>> => {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const w = resolveWindow(range)
    const orderDay = dayKey(orders.createdAt)
    const userDay = dayKey(user.createdAt)
    const creditDay = dayKey(creditTransactions.createdAt)

    const [orderRows, userRows, creditRows] = await Promise.all([
      db
        .select({
          day: orderDay,
          revenue: sumWhere(netAmount, inReportingCurrency),
          orders: count(),
        })
        .from(orders)
        .where(and(inArray(orders.status, SETTLED_STATUSES), gte(orders.createdAt, w.start)))
        .groupBy(orderDay),
      db
        .select({ day: userDay, signups: count() })
        .from(user)
        .where(and(eq(user.isAnonymous, false), gte(user.createdAt, w.start)))
        .groupBy(userDay),
      db
        .select({
          day: creditDay,
          consumed: sql`COALESCE(SUM(-${creditTransactions.amount}), 0)`.mapWith(Number),
        })
        .from(creditTransactions)
        .where(
          and(
            gte(creditTransactions.createdAt, w.start),
            inArray(creditTransactions.type, ['usage', 'usage_refund'])
          )
        )
        .groupBy(creditDay),
    ])

    const byDay = new Map<string, TrendPoint>()
    for (let t = w.start.getTime(); t <= w.end.getTime(); t += DAY_MS) {
      const date = utcDayKey(new Date(t))
      byDay.set(date, { date, revenue: 0, signups: 0, orders: 0, creditsConsumed: 0 })
    }
    for (const r of orderRows) {
      const p = byDay.get(r.day)
      if (p) Object.assign(p, { revenue: r.revenue, orders: r.orders })
    }
    for (const r of userRows) {
      const p = byDay.get(r.day)
      if (p) p.signups = r.signups
    }
    for (const r of creditRows) {
      const p = byDay.get(r.day)
      if (p) p.creditsConsumed = r.consumed
    }

    return actionResponse.success({ currency: REPORTING_CURRENCY, points: [...byDay.values()] })
  } catch (error) {
    return actionResponse.error(getErrorMessage(error))
  }
}

// ────────────────────────────────────────────────────────────────
//  3. Breakdowns — revenue by plan / provider and signups by source, within the window
// ────────────────────────────────────────────────────────────────

/** Sentinel key for the folded tail; the UI renders it as "Other" */
export type BreakdownKey = string

export interface BreakdownItem {
  /** planId / provider / utm_source (or referrer domain, or 'direct') / '__other__' */
  key: BreakdownKey
  value: number
}

export interface OverviewBreakdowns {
  currency: string
  revenueByPlan: BreakdownItem[]
  revenueByProvider: BreakdownItem[]
  signupsBySource: BreakdownItem[]
}

const BREAKDOWN_TOP_N = 5

/** Keep the top N items and fold the remainder into '__other__'; a zero remainder emits no sentinel row */
function foldTail(items: BreakdownItem[], keep = BREAKDOWN_TOP_N): BreakdownItem[] {
  const head = items.slice(0, keep)
  const rest = items.slice(keep).reduce((sum, i) => sum + i.value, 0)
  return rest > 0 ? [...head, { key: '__other__', value: rest }] : head
}

export const getOverviewBreakdowns = async (
  range: OverviewRange
): Promise<ActionResult<OverviewBreakdowns>> => {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const w = resolveWindow(range)
    const settledInWindow = and(
      inArray(orders.status, SETTLED_STATUSES),
      gte(orders.createdAt, w.start),
      inReportingCurrency
    )
    const revenue = sql`COALESCE(SUM(${netAmount}), 0)`.mapWith(Number)
    const source = sql<string>`COALESCE(NULLIF(${userSource.utmSource}, ''), NULLIF(${userSource.referrerDomain}, ''), 'direct')`
    const signups = count()

    const [planRows, providerRows, sourceRows] = await Promise.all([
      db
        .select({ key: orders.planId, value: revenue })
        .from(orders)
        .where(settledInWindow)
        .groupBy(orders.planId)
        .orderBy(desc(revenue)),
      db
        .select({ key: orders.provider, value: revenue })
        .from(orders)
        .where(settledInWindow)
        .groupBy(orders.provider)
        .orderBy(desc(revenue)),
      db
        .select({ key: source, value: signups })
        .from(user)
        .leftJoin(userSource, eq(userSource.userId, user.id))
        .where(and(eq(user.isAnonymous, false), gte(user.createdAt, w.start)))
        .groupBy(source)
        .orderBy(desc(signups)),
    ])

    return actionResponse.success({
      currency: REPORTING_CURRENCY,
      revenueByPlan: foldTail(planRows.filter((r) => r.value > 0)),
      revenueByProvider: providerRows.filter((r) => r.value > 0),
      signupsBySource: foldTail(sourceRows),
    })
  } catch (error) {
    return actionResponse.error(getErrorMessage(error))
  }
}

// ────────────────────────────────────────────────────────────────
//  4. Needs attention — ops to-do counts (standing items ignore the window, event items are scoped to it)
// ────────────────────────────────────────────────────────────────

export interface OverviewAttention {
  /** past_due / unpaid subscriptions (standing) */
  pastDueSubscriptions: number
  /** In-flight, unsettled orders (standing) */
  pendingOrders: number
  /** Active subscriptions scheduled to cancel at period end (standing) */
  cancelScheduled: number
  /** submitted / under_review feedback (standing) */
  openFeedback: number
  /** Bounced / failed orders in this window */
  failedOrders: number
  /** Settled orders in this window outside the reporting currency — counted in no money metric */
  foreignCurrencyOrders: number
}

export const getOverviewAttention = async (
  range: OverviewRange
): Promise<ActionResult<OverviewAttention>> => {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const w = resolveWindow(range)
    const [[orderRow], [subRow], [feedbackRow]] = await Promise.all([
      db
        .select({
          pending: countWhere(sql`${orders.status} = 'pending'`),
          failed: countWhere(sql`${orders.status} = 'failed' AND ${orders.createdAt} >= ${ts(w.start)}`),
          foreign: countWhere(
            sql`${orders.status} IN ('completed', 'partially_refunded', 'refunded') AND ${orders.createdAt} >= ${ts(w.start)} AND NOT (${inReportingCurrency})`
          ),
        })
        .from(orders)
        .where(or(eq(orders.status, 'pending'), gte(orders.createdAt, w.start))),
      db
        .select({
          pastDue: countWhere(sql`${subscriptions.status} IN ('past_due', 'unpaid')`),
          cancelScheduled: countWhere(
            sql`${subscriptions.status} = 'active' AND ${subscriptions.cancelAtPeriodEnd} = true`
          ),
        })
        .from(subscriptions)
        .where(
          or(
            inArray(subscriptions.status, [...AT_RISK_STATUSES]),
            and(eq(subscriptions.status, 'active'), eq(subscriptions.cancelAtPeriodEnd, true))
          )
        ),
      db
        .select({ open: count() })
        .from(feedback)
        .where(inArray(feedback.status, ['submitted', 'under_review'])),
    ])

    return actionResponse.success({
      pastDueSubscriptions: subRow.pastDue,
      pendingOrders: orderRow.pending,
      cancelScheduled: subRow.cancelScheduled,
      openFeedback: feedbackRow.open,
      failedOrders: orderRow.failed,
      foreignCurrencyOrders: orderRow.foreign,
    })
  } catch (error) {
    return actionResponse.error(getErrorMessage(error))
  }
}

// ────────────────────────────────────────────────────────────────
//  5. Recent orders — any status, in-flight and failed included, so ops see the latest movement at a glance
// ────────────────────────────────────────────────────────────────

export interface RecentOrder {
  id: string
  /** Payer email; null once the account is deleted */
  userEmail: string | null
  planId: string
  orderType: OrderType
  status: OrderStatus
  amountTotal: number
  amountRefunded: number
  currency: string
  provider: PaymentProvider
  createdAt: Date
}

const RECENT_ORDERS_LIMIT = 8

export const getRecentOrders = async (): Promise<ActionResult<RecentOrder[]>> => {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const rows = await db
      .select({
        id: orders.id,
        userEmail: user.email,
        planId: orders.planId,
        orderType: orders.orderType,
        status: orders.status,
        amountTotal: orders.amountTotal,
        amountRefunded: orders.amountRefunded,
        currency: orders.currency,
        provider: orders.provider,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .leftJoin(user, eq(user.id, orders.userId))
      .orderBy(desc(orders.createdAt))
      .limit(RECENT_ORDERS_LIMIT)
    return actionResponse.success(rows)
  } catch (error) {
    return actionResponse.error(getErrorMessage(error))
  }
}
