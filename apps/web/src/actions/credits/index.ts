/**
 * [INPUT]: Depends on @/lib/credits for its read/write APIs, @/lib/db and
 *          schema for the creditTransactions table, @/lib/auth/server for
 *          getSession and getWorkspaceContext (workspace context)
 * [OUTPUT]: Exports getMyBillingSummary, getMyCredits (active workspace
 *           balances: team workspace = the org shared pool), getMyCreditHistory
 *           (personal rows only, organizationId IS NULL, filtering out
 *           subscription_cycle_expire bookkeeping rows, ordered by
 *           createdAt+seq), consumeCredits (spends from the pool of the
 *           active workspace)
 * [POS]: The user-side entry point of actions/credits — feature code calls
 *        consumeCredits to spend, the billing page reads getMyBillingSummary,
 *        the history page reads getMyCreditHistory
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

'use server';

import { actionResponse, ActionResult } from '@/lib/action-response';
import { getSession, getWorkspaceContext } from '@/lib/auth/server';
import type { BillingSummary, UserCredits } from '@/lib/credits';
import {
  getOrganizationCredits,
  getUserBillingSummary,
  getUserCredits,
  InsufficientCreditsError,
  spendCredits,
} from '@/lib/credits';
import { db } from '@/lib/db';
import {
  creditTransactions,
  CreditTransactionType,
} from '@/lib/db/schema';
import { getLogger } from '@/lib/logger';
import { and, count, desc, eq, isNull, ne } from 'drizzle-orm';

const logger = getLogger('credits.user')

/** Balance + subscription state for the signed-in user (billing page). */
export async function getMyBillingSummary(): Promise<
  ActionResult<BillingSummary>
> {
  const session = await getSession()
  const user = session?.user
  if (!user) return actionResponse.unauthorized()

  try {
    return actionResponse.success(await getUserBillingSummary(user.id))
  } catch (error) {
    logger.error(
      { err: error, userId: user.id },
      'Failed to load user billing summary.'
    )
    return actionResponse.error('Failed to load billing summary.')
  }
}

/**
 * Balances of the ACTIVE WORKSPACE — cheap call for header widgets and
 * generators. In a team workspace this is the org's shared pool (the pool a
 * consumption would spend from); in the personal workspace, the own buckets.
 */
export async function getMyCredits(): Promise<ActionResult<UserCredits>> {
  const workspace = await getWorkspaceContext()
  if (!workspace) return actionResponse.unauthorized()

  try {
    return actionResponse.success(
      workspace.organizationId
        ? await getOrganizationCredits(workspace.organizationId)
        : await getUserCredits(workspace.userId)
    )
  } catch (error) {
    logger.error(
      {
        err: error,
        userId: workspace.userId,
        organizationId: workspace.organizationId,
      },
      'Failed to load active workspace credits.'
    )
    return actionResponse.error('Failed to load credits.')
  }
}

export interface CreditHistoryPage {
  items: {
    id: string
    type: CreditTransactionType
    amount: number
    subscriptionCreditsAfter: number
    purchasedCreditsAfter: number
    note: string | null
    createdAt: Date
  }[]
  total: number
}

/** Paginated ledger history for the signed-in user. */
export async function getMyCreditHistory(params: {
  pageIndex: number
  pageSize: number
  type?: CreditTransactionType
}): Promise<ActionResult<CreditHistoryPage>> {
  const session = await getSession()
  const user = session?.user
  if (!user) return actionResponse.unauthorized()

  const { pageIndex, pageSize, type } = params
  const where = and(
    eq(creditTransactions.userId, user.id),
    // Personal ledger only: org-pool rows carry the ORG's balance snapshots —
    // mixing them in would corrupt the running-balance column. Team activity
    // lives on the team page with per-member attribution.
    isNull(creditTransactions.organizationId),
    // Cycle-expire rows are bookkeeping, not user activity: the renewal
    // grant already shows the full amount, so surfacing the expiry would
    // only read as "my credits were taken". Admin audit views keep them.
    ne(creditTransactions.type, 'subscription_cycle_expire'),
    type ? eq(creditTransactions.type, type) : undefined
  )

  try {
    const [items, [{ total }]] = await Promise.all([
      db
        .select({
          id: creditTransactions.id,
          type: creditTransactions.type,
          amount: creditTransactions.amount,
          subscriptionCreditsAfter: creditTransactions.subscriptionCreditsAfter,
          purchasedCreditsAfter: creditTransactions.purchasedCreditsAfter,
          note: creditTransactions.note,
          createdAt: creditTransactions.createdAt,
        })
        .from(creditTransactions)
        .where(where)
        // seq tiebreak: rows written in one transaction (cycle expire + grant)
        // share createdAt; insertion order must win.
        .orderBy(desc(creditTransactions.createdAt), desc(creditTransactions.seq))
        .limit(pageSize)
        .offset(pageIndex * pageSize),
      db.select({ total: count() }).from(creditTransactions).where(where),
    ])

    return actionResponse.success({ items, total })
  } catch (error) {
    logger.error(
      { err: error, userId: user.id },
      'Failed to load user credit history.'
    )
    return actionResponse.error('Failed to load credit history.')
  }
}

/**
 * Spend credits on a feature. Call this from feature code BEFORE running the
 * expensive operation; the note lands in the user's visible history.
 *
 * `txId` identifies the usage ledger row — server-side task code keeps it
 * (e.g. on the task row) and calls lib/credits' refundSpentCredits with it
 * when the task fails. There is deliberately NO client-callable refund
 * action: a user who can trigger refunds gets every task for free.
 */
export async function consumeCredits(params: {
  amount: number
  note: string
}): Promise<ActionResult<UserCredits & { txId: string }>> {
  const session = await getSession()
  const user = session?.user
  if (!user) return actionResponse.unauthorized()

  const { amount, note } = params
  if (!Number.isInteger(amount) || amount <= 0) {
    return actionResponse.badRequest('Amount must be a positive integer.')
  }
  if (!note) {
    return actionResponse.badRequest('A note describing the usage is required.')
  }

  try {
    // spendCredits (facade) settles any due yearly-drip grant internally.
    // The active workspace picks the pool — team workspace = org shared pool.
    const workspace = await getWorkspaceContext()
    const { buckets, txId } = await spendCredits({
      userId: user.id,
      organizationId: workspace?.organizationId ?? null,
      amount,
      note,
    })
    return actionResponse.success({
      subscriptionCredits: buckets.subscription,
      purchasedCredits: buckets.purchased,
      totalCredits: buckets.subscription + buckets.purchased,
      txId,
    })
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return actionResponse.badRequest(
        'Insufficient credits.',
        'INSUFFICIENT_CREDITS'
      )
    }
    logger.error(
      { err: error, userId: user.id, amount },
      'Failed to consume credits.'
    )
    return actionResponse.error('Failed to consume credits.')
  }
}
