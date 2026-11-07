/**
 * [INPUT]: Depends on @/lib/db and schema's user/session/userSource/orders/
 *          creditTransactions/creditBalances/member/subscriptions tables,
 *          @/lib/credits' getUserBillingSummary and
 *          ENTITLED_SUBSCRIPTION_STATUSES (source of truth for the live
 *          subscription status set), @/lib/storage/account-purge's
 *          purgeUserArtifacts, @/lib/auth/server's getFreshSession + isAdmin
 *          (privileged checks read past the cookie cache),
 *          permissions' role predicates
 * [OUTPUT]: exports getUsers (carries lastActiveAt, the last-active moment
 *           derived by aggregating the session table — the dormant-user
 *           criterion, zero new tables and zero new columns; creditBalances
 *           balances; the sort param drives server-side ordering over a column
 *           whitelist; banned / role / signup-date-range filters, where
 *           createdFrom / createdTo are ISO instants the client derived from
 *           local calendar days; ipAddress is the signup IP captured by
 *           userSource; totalSpentCents / totalSpentBreakdown are the lifetime
 *           net spend derived from orders, summed per currency, the primary
 *           currency being the sortable figure),
 *           getUserDetailForAdmin, banUser, unbanUser,
 *           updateUserRole, deleteUserAccount (superadmin-only account
 *           deletion: dual guard on a live subscription (dunning included) /
 *           organization owner → purge R2 → delete the row;
 *           ledger/order/subscription records are all kept de-identified via
 *           FK SET NULL, so statistics and audit history never shrink);
 *           types UserWithSource, AdminUserDetail
 * [POS]: The admin side of actions/users — user list/detail queries and account
 *        management (ban / role / delete); the detail aggregates balances,
 *        subscription and lifetime stats for the admin/users/[userId] page
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use server";

import type { ActionResult } from '@/lib/action-response';
import { actionResponse } from '@/lib/action-response';
import { getFreshSession, isAdmin } from '@/lib/auth/server';
import { isAdminUserRole, isSuperAdminUserRole } from '@/lib/auth/permissions';
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  getUserBillingSummary,
  type BillingSummary,
} from '@/lib/credits';
import { db } from '@/lib/db';
import {
  creditBalances,
  creditTransactions,
  member as memberSchema,
  orders as ordersSchema,
  session as sessionSchema,
  subscriptions as subscriptionsSchema,
  user as userSchema,
  UserType,
  userSource as userSourceSchema,
} from '@/lib/db/schema';
import { getErrorMessage } from '@/lib/error-utils';
import { purgeUserArtifacts } from '@/lib/storage/account-purge';
import { DEFAULT_CURRENCY } from '@/config/common';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';

/** One currency's share of a user's lifetime net spend (cents) */
export interface SpentBreakdownEntry {
  currency: string;
  cents: number;
}

// Extended user type with fields from userSource and creditBalances
export type UserWithSource = UserType & {
  affCode?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  referrer?: string | null;
  countryCode?: string | null;
  browser?: string | null;
  os?: string | null;
  deviceType?: string | null;
  deviceBrand?: string | null;
  deviceModel?: string | null;
  language?: string | null;
  /** Signup IP captured by userSource (fraud checks / several accounts on one address); null when attribution was not recorded */
  ipAddress?: string | null;
  /** Last-active moment (session updatedAt advances on every session refresh; MAX over all rows; null when the user has no session row) */
  lastActiveAt?: Date | null;
  /** Lifetime net spend in DEFAULT_CURRENCY (cents): the figure the column shows and sorts by; 0 without settled orders in that currency */
  totalSpentCents?: number;
  /** Lifetime net spend per currency, largest first; empty without settled orders. Multi-provider means multi-currency, so sums never cross a currency */
  totalSpentBreakdown?: SpentBreakdownEntry[];
  credits?: {
    subscriptionCredits: number;
    purchasedCredits: number;
    totalCredits: number;
  } | null;
};

export interface GetUsersResult {
  success: boolean;
  data?: {
    users: UserWithSource[];
    totalCount: number;
  };
  error?: string;
}

const DEFAULT_PAGE_SIZE = 20;

export async function getUsers({
  pageIndex = 0,
  pageSize = DEFAULT_PAGE_SIZE,
  filter = "",
  banned,
  role,
  createdFrom,
  createdTo,
  sort,
}: {
  pageIndex?: number;
  pageSize?: number;
  filter?: string;
  /** Ban-state filter; undefined = all */
  banned?: boolean;
  /** Role filter (user / admin / superadmin); undefined = all */
  role?: 'user' | 'admin' | 'superadmin';
  /** Signup-date range as ISO instants (the client turns local calendar days into ISO, so timestamptz compares directly) */
  createdFrom?: string;
  createdTo?: string;
  /** Server-side sort (paging is server side, so client-side sorting would only order the current page); id must be in the sortable-column whitelist */
  sort?: { id: string; desc: boolean };
}): Promise<GetUsersResult> {
  if (!(await isAdmin())) {
    return actionResponse.forbidden('Admin privileges required.');
  }

  try {
    const conditions = [];
    if (filter) {
      conditions.push(
        or(
          ilike(userSchema.email, `%${filter}%`),
          ilike(userSchema.name, `%${filter}%`)
        )
      );
    }
    if (banned !== undefined) {
      conditions.push(eq(userSchema.banned, banned));
    }
    if (role) {
      conditions.push(eq(userSchema.role, role));
    }
    if (createdFrom) {
      conditions.push(gte(userSchema.createdAt, new Date(createdFrom)));
    }
    if (createdTo) {
      conditions.push(lte(userSchema.createdAt, new Date(createdTo)));
    }
    // Filters narrow each other (AND); the search itself is the one OR above.
    // Shared by the page query and the count query so both agree.
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // ── Last-active derivation ───────────────────────────────────────
    // The session table IS the activity source of truth: updatedAt advances on
    // every session refresh, so MAX is that user's last-active moment (the
    // dormant-user criterion). Grouped by userId, zero new tables or columns.
    // Caveat on semantics: banning/demoting wipes the session rows, after which
    // the column shows "-" (no active session).
    const lastActive = db
      .select({
        userId: sessionSchema.userId,
        lastActiveAt: sql<Date>`MAX(${sessionSchema.updatedAt})`.as('last_active_at'),
      })
      .from(sessionSchema)
      .groupBy(sessionSchema.userId)
      .as('last_active');

    // ── Lifetime net spend derivation ─────────────────────────────────
    // The orders table IS the spend source of truth: net = Σ(amountTotal -
    // amountRefunded) in cents, and a refund rewrites the original row so the
    // aggregate shrinks by itself. Only settled orders count: pending (eCheck
    // clearing) and failed rows carry an amount that was never collected.
    // Multi-provider means multi-currency, so a sum never crosses a currency:
    // the inner query groups by (userId, currency), the outer one folds that
    // into one JSON breakdown per user plus the primary-currency total the
    // column shows and sorts by. Codes are lowercased because providers
    // disagree on case (Stripe "usd", PayPal "USD").
    const spentCurrency = sql<string>`LOWER(${ordersSchema.currency})`;
    const spentByCurrency = db
      .select({
        userId: ordersSchema.userId,
        currency: spentCurrency.as('spent_currency'),
        cents: sql<number>`SUM(${ordersSchema.amountTotal} - ${ordersSchema.amountRefunded})`.as('spent_cents'),
      })
      .from(ordersSchema)
      .where(
        and(
          isNotNull(ordersSchema.userId),
          inArray(ordersSchema.status, ['completed', 'partially_refunded', 'refunded'])
        )
      )
      .groupBy(ordersSchema.userId, spentCurrency)
      .as('spent_by_currency');
    const userSpent = db
      .select({
        userId: spentByCurrency.userId,
        primaryCents: sql<number>`COALESCE(SUM(${spentByCurrency.cents}) FILTER (WHERE ${spentByCurrency.currency} = ${DEFAULT_CURRENCY}), 0)`.as('primary_spent_cents'),
        breakdown: sql<SpentBreakdownEntry[]>`json_agg(json_build_object('currency', ${spentByCurrency.currency}, 'cents', ${spentByCurrency.cents}) ORDER BY ${spentByCurrency.cents} DESC)`.as('spent_breakdown'),
      })
      .from(spentByCurrency)
      .groupBy(spentByCurrency.userId)
      .as('user_spent');

    const totalCreditsSql = sql<number>`COALESCE(${creditBalances.subscriptionCredits}, 0) + COALESCE(${creditBalances.purchasedCredits}, 0)`;

    // Server-side sort whitelist: column id → sort expression. Any id outside
    // the map falls back to newest-signup-first; whatever the client sends can
    // never be spliced into the SQL (injection-proof).
    const sortableColumns = {
      credits: totalCreditsSql,
      totalSpent: sql`COALESCE(${userSpent.primaryCents}, 0)`,
      lastActiveAt: lastActive.lastActiveAt,
      stripeCustomerId: userSchema.stripeCustomerId,
      countryCode: userSourceSchema.countryCode,
      browser: userSourceSchema.browser,
      os: userSourceSchema.os,
      affCode: userSourceSchema.affCode,
    } as const;
    const sortColumn =
      sort && sort.id in sortableColumns
        ? sortableColumns[sort.id as keyof typeof sortableColumns]
        : undefined;
    // Postgres orders NULLs first on DESC, so "last active, newest first"
    // would pin every never-signed-in user to the top. Empty values sink to
    // the bottom in both directions (ASC already defaults to NULLS LAST).
    const orderByClause = sortColumn
      ? sort!.desc
        ? sql`${sortColumn} DESC NULLS LAST`
        : asc(sortColumn)
      : desc(userSchema.createdAt);

    // Query users with left join to userSource for source tracking fields
    // and creditBalances for the user's current credit balance.
    const usersQuery = db
      .select({
        // User fields
        id: userSchema.id,
        email: userSchema.email,
        emailVerified: userSchema.emailVerified,
        name: userSchema.name,
        image: userSchema.image,
        role: userSchema.role,
        isAnonymous: userSchema.isAnonymous,
        stripeCustomerId: userSchema.stripeCustomerId,
        creemCustomerId: userSchema.creemCustomerId,
        paypalPayerId: userSchema.paypalPayerId,
        banned: userSchema.banned,
        banReason: userSchema.banReason,
        banExpires: userSchema.banExpires,
        createdAt: userSchema.createdAt,
        updatedAt: userSchema.updatedAt,
        // UserSource fields
        affCode: userSourceSchema.affCode,
        utmSource: userSourceSchema.utmSource,
        utmMedium: userSourceSchema.utmMedium,
        utmCampaign: userSourceSchema.utmCampaign,
        utmTerm: userSourceSchema.utmTerm,
        utmContent: userSourceSchema.utmContent,
        referrer: userSourceSchema.referrer,
        countryCode: userSourceSchema.countryCode,
        browser: userSourceSchema.browser,
        os: userSourceSchema.os,
        deviceType: userSourceSchema.deviceType,
        deviceBrand: userSourceSchema.deviceBrand,
        deviceModel: userSourceSchema.deviceModel,
        language: userSourceSchema.language,
        ipAddress: userSourceSchema.ipAddress,
        // Last active field (derived from session table)
        lastActiveAt: lastActive.lastActiveAt,
        // Lifetime net spend (derived from the orders table, per currency)
        totalSpentCents: sql<number>`COALESCE(${userSpent.primaryCents}, 0)`.mapWith(Number),
        totalSpentBreakdown: sql<SpentBreakdownEntry[]>`COALESCE(${userSpent.breakdown}, '[]'::json)`,
        // Credit balance fields
        subscriptionCredits: sql<number>`COALESCE(${creditBalances.subscriptionCredits}, 0)`.mapWith(Number),
        purchasedCredits: sql<number>`COALESCE(${creditBalances.purchasedCredits}, 0)`.mapWith(Number),
        totalCredits: totalCreditsSql.mapWith(Number),
      })
      .from(userSchema)
      .leftJoin(userSourceSchema, eq(userSchema.id, userSourceSchema.userId))
      .leftJoin(creditBalances, eq(userSchema.id, creditBalances.userId))
      .leftJoin(lastActive, eq(userSchema.id, lastActive.userId))
      .leftJoin(userSpent, eq(userSchema.id, userSpent.userId))
      .where(whereClause)
      .orderBy(orderByClause)
      .offset(pageIndex * pageSize)
      .limit(pageSize);

    const totalCountQuery = db
      .select({ value: count() })
      .from(userSchema)
      .where(whereClause);

    const [results, totalCountResult] = await Promise.all([
      usersQuery,
      totalCountQuery,
    ]);

    const totalCount = totalCountResult[0].value;

    return actionResponse.success({
      users: results.map((user) => ({
        ...user,
        credits: {
          subscriptionCredits: user.subscriptionCredits,
          purchasedCredits: user.purchasedCredits,
          totalCredits: user.totalCredits,
        },
      })) as UserWithSource[],
      totalCount: totalCount,
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return actionResponse.error(getErrorMessage(error));
  }
}

export interface AdminUserDetail {
  user: Pick<
    UserType,
    | 'id'
    | 'email'
    | 'emailVerified'
    | 'name'
    | 'image'
    | 'role'
    | 'stripeCustomerId'
    | 'banned'
    | 'banReason'
    | 'createdAt'
  >
  billing: BillingSummary
  lifetime: {
    ordersCount: number
    /** Net revenue from this user: Σ(amountTotal - amountRefunded), cents */
    netRevenueCents: number
    /** Total credits burned on features (positive number) */
    creditsConsumed: number
  }
}

/** Everything the admin user-detail page needs, in one round trip. */
export async function getUserDetailForAdmin({
  userId,
}: {
  userId: string;
}): Promise<ActionResult<AdminUserDetail>> {
  if (!(await isAdmin())) {
    return actionResponse.forbidden('Admin privileges required.');
  }

  try {
    const [userRow] = await db
      .select({
        id: userSchema.id,
        email: userSchema.email,
        emailVerified: userSchema.emailVerified,
        name: userSchema.name,
        image: userSchema.image,
        role: userSchema.role,
        stripeCustomerId: userSchema.stripeCustomerId,
        banned: userSchema.banned,
        banReason: userSchema.banReason,
        createdAt: userSchema.createdAt,
      })
      .from(userSchema)
      .where(eq(userSchema.id, userId))
      .limit(1);

    if (!userRow) {
      return actionResponse.notFound('User not found.');
    }

    const [billing, [orderTotals], [usageTotals]] = await Promise.all([
      getUserBillingSummary(userId),
      db
        .select({
          ordersCount: count(),
          netRevenueCents: sql`COALESCE(SUM(${ordersSchema.amountTotal} - ${ordersSchema.amountRefunded}), 0)`.mapWith(
            Number
          ),
        })
        .from(ordersSchema)
        .where(eq(ordersSchema.userId, userId)),
      db
        .select({
          creditsConsumed: sql`COALESCE(SUM(-${creditTransactions.amount}), 0)`.mapWith(
            Number
          ),
        })
        .from(creditTransactions)
        .where(
          and(
            eq(creditTransactions.userId, userId),
            eq(creditTransactions.type, 'usage')
          )
        ),
    ]);

    return actionResponse.success({
      user: userRow,
      billing,
      lifetime: {
        ordersCount: orderTotals.ordersCount,
        netRevenueCents: orderTotals.netRevenueCents,
        creditsConsumed: usageTotals.creditsConsumed,
      },
    });
  } catch (error) {
    console.error('getUserDetailForAdmin failed:', error);
    return actionResponse.error(getErrorMessage(error));
  }
}

export async function banUser({
  userId,
  reason,
}: {
  userId: string;
  reason?: string;
}): Promise<ActionResult> {
  if (!(await isAdmin())) {
    return actionResponse.forbidden('Admin privileges required.');
  }

  try {
    const target = await db
      .select({ id: userSchema.id, role: userSchema.role })
      .from(userSchema)
      .where(eq(userSchema.id, userId))
      .limit(1);

    if (target.length === 0) {
      return actionResponse.notFound('User not found.');
    }

    if (isAdminUserRole(target[0].role)) {
      return actionResponse.forbidden('Cannot ban admin users.');
    }

    await db
      .update(userSchema)
      .set({ banned: true, banReason: reason ?? 'Banned by admin', banExpires: null })
      .where(eq(userSchema.id, userId));

    // Revoke all sessions for this user to enforce immediate logout
    await db.delete(sessionSchema).where(eq(sessionSchema.userId, userId));

    return actionResponse.success();
  } catch (error: any) {
    return actionResponse.error(getErrorMessage(error));
  }
}

export async function unbanUser({
  userId,
}: {
  userId: string;
}): Promise<ActionResult> {
  if (!(await isAdmin())) {
    return actionResponse.forbidden('Admin privileges required.');
  }

  try {
    const target = await db
      .select({ id: userSchema.id })
      .from(userSchema)
      .where(eq(userSchema.id, userId))
      .limit(1);

    if (target.length === 0) {
      return actionResponse.notFound('User not found.');
    }

    await db
      .update(userSchema)
      .set({ banned: false, banReason: null, banExpires: null })
      .where(eq(userSchema.id, userId));

    return actionResponse.success();
  } catch (error: any) {
    return actionResponse.error(getErrorMessage(error));
  }
}

export async function updateUserRole({
  userId,
  role,
}: {
  userId: string;
  role: 'user' | 'admin';
}): Promise<ActionResult> {
  const session = await getFreshSession();
  if (!session?.user) {
    return actionResponse.forbidden('Authentication required.');
  }

  if (!isSuperAdminUserRole(session.user.role)) {
    return actionResponse.forbidden('Super admin privileges required.');
  }

  if (userId === session.user.id) {
    return actionResponse.forbidden('Cannot modify your own role.');
  }

  try {
    const target = await db
      .select({ id: userSchema.id, role: userSchema.role })
      .from(userSchema)
      .where(eq(userSchema.id, userId))
      .limit(1);

    if (target.length === 0) {
      return actionResponse.notFound('User not found.');
    }

    if (isSuperAdminUserRole(target[0].role)) {
      return actionResponse.forbidden('Cannot modify superadmin users.');
    }

    await db
      .update(userSchema)
      .set({ role })
      .where(eq(userSchema.id, userId));

    // Demoting from admin -> revoke all sessions for immediate effect
    if (role === 'user') {
      await db.delete(sessionSchema).where(eq(sessionSchema.userId, userId));
    }

    return actionResponse.success();
  } catch (error: any) {
    return actionResponse.error(getErrorMessage(error));
  }
}

/**
 * Account deletion (superadmin only, the single admin-side entry point).
 * Cross-subject guards run first — any one of them refuses the delete and the
 * admin has to resolve it first:
 *   1. Has a live subscription (personal, or as a team's purchaser): the
 *      provider is still charging — cancel/refund first;
 *   2. Is the owner of any organization: transfer ownership first, or wind the
 *      team down through the organization-deletion guard.
 * Once past the guards the closed loop runs in order: purge R2 (before the row
 * goes — once the row is gone the objects are permanent orphans) → delete the
 * user row. Personal data (user/session/account/member/balance rows) cascades
 * away; ledger/order/subscription rows are kept de-identified via FK SET NULL —
 * financial and operational records do not evaporate with the account, so the
 * Overview statistics and the site-wide audit history never shrink.
 *
 * Note on this repository: tasks live only in Redis (task-store, TTL 1h) and
 * there is no ai_tasks table, hence no in-flight-task guard — Redis tasks die
 * off with their TTL, and generated artifacts are never persisted under the
 * user's R2 prefix, so there is no orphan-object risk.
 */
export async function deleteUserAccount({
  userId,
}: {
  userId: string;
}): Promise<ActionResult> {
  const session = await getFreshSession();
  if (!session?.user) {
    return actionResponse.forbidden('Authentication required.');
  }
  if (!isSuperAdminUserRole(session.user.role)) {
    return actionResponse.forbidden('Super admin privileges required.');
  }
  if (userId === session.user.id) {
    return actionResponse.forbidden('Cannot delete your own account.');
  }

  try {
    const target = await db
      .select({ id: userSchema.id, role: userSchema.role })
      .from(userSchema)
      .where(eq(userSchema.id, userId))
      .limit(1);
    if (target.length === 0) {
      return actionResponse.notFound('User not found.');
    }
    if (isSuperAdminUserRole(target[0].role)) {
      return actionResponse.forbidden('Cannot delete superadmin users.');
    }

    // past_due/unpaid are still alive on the provider side (a dunning retry can
    // succeed at any moment), so they are blocked alongside active/trialing —
    // otherwise a late subscription webhook arriving after the delete would
    // upsert a ghost userId back into a subscriptions row, retrying forever on
    // an FK violation.
    const [liveSub] = await db
      .select({ id: subscriptionsSchema.id })
      .from(subscriptionsSchema)
      .where(
        and(
          eq(subscriptionsSchema.userId, userId),
          inArray(subscriptionsSchema.status, ENTITLED_SUBSCRIPTION_STATUSES)
        )
      )
      .limit(1);
    if (liveSub) {
      return actionResponse.conflict(
        'User has a live subscription (active, trialing, or in dunning). Cancel it first.',
        'ACTIVE_SUBSCRIPTION'
      );
    }

    const [ownedOrg] = await db
      .select({ id: memberSchema.id })
      .from(memberSchema)
      .where(
        and(eq(memberSchema.userId, userId), eq(memberSchema.role, 'owner'))
      )
      .limit(1);
    if (ownedOrg) {
      return actionResponse.conflict(
        'User owns a team. Transfer ownership or wind the team down first.',
        'OWNS_ORGANIZATION'
      );
    }

    // R2 cleanup must precede the row delete. A throw aborts the deletion; the
    // retry converges (DeleteObject is idempotent).
    await purgeUserArtifacts(userId);

    // Ledger rows are deliberately NOT deleted: FK SET NULL on
    // credit_transactions.userId keeps the whole trail in de-identified form —
    // a physical delete would shrink Overview's historical grant/consumption
    // statistics, break the site-wide audit, and contradict the privacy policy's
    // "transaction records are retained in de-identified form". The
    // credit_balances row (derived state) cascades away with the user FK.
    await db.delete(userSchema).where(eq(userSchema.id, userId));

    return actionResponse.success();
  } catch (error: any) {
    console.error('deleteUserAccount failed:', error);
    return actionResponse.error(getErrorMessage(error));
  }
}
