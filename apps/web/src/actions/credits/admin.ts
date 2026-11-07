/**
 * [INPUT]: Depends on @/lib/credits' adjustCredits/getUserCredits, @/lib/db and
 *          schema's creditTransactions/user tables, @/lib/auth/server's
 *          getSession + isAdmin
 * [OUTPUT]: exports adjustUserCredits, getUserCreditsForAdmin,
 *           getAdminCreditTransactions, grantCreditsToUsers (server actions)
 * [POS]: The admin side of actions/credits — manual adjustment, batch grants and
 *        global ledger audit; every change requires a note and is written to the
 *        ledger (including the acting admin)
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

'use server';

import { actionResponse, ActionResult } from '@/lib/action-response';
import { getFreshSession, isAdmin } from '@/lib/auth/server';
import {
  addCredits,
  adjustCredits,
  deductCredits,
  getUserCredits,
  runCommerceTransaction,
  setCredits,
  type UserCredits,
} from '@/lib/credits';
import { db } from '@/lib/db';
import {
  CreditTransactionType,
  creditTransactions,
  user as userSchema,
} from '@/lib/db/schema';
import { getLogger } from '@/lib/logger';
import { and, count, desc, eq, ilike, inArray, sql } from 'drizzle-orm';

const logger = getLogger('credits.admin')

/** Hard cap for one batch grant — keeps the transaction bounded. */
const BATCH_GRANT_MAX_RECIPIENTS = 200

/** Fresh server-resolved acting admin; null when missing, banned, or not admin. */
async function requireFreshAdmin(): Promise<{
  userId: string
  email: string | null
  role: 'admin' | 'superadmin'
} | null> {
  const session = await getFreshSession()
  if (!session?.user) return null
  const role = session.user.role
  if (role !== 'admin' && role !== 'superadmin') return null
  return { userId: session.user.id, email: session.user.email, role }
}

export type AdminCreditBucket = 'subscription' | 'purchased'

function toUserCredits(buckets: {
  subscription: number
  purchased: number
}): UserCredits {
  return {
    subscriptionCredits: buckets.subscription,
    purchasedCredits: buckets.purchased,
    totalCredits: buckets.subscription + buckets.purchased,
  }
}

/** Validate a server-action reason as a non-empty string; returns trimmed value or null. */
function requireReason(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Manually grant (positive) or remove (negative) credits for a user.
 * The acting admin and reason are recorded in the ledger note.
 */
export async function adjustUserCredits(params: {
  userId: string
  delta: number
  reason: string
}): Promise<ActionResult<UserCredits>> {
  const actor = await requireFreshAdmin()
  if (!actor) return actionResponse.forbidden()

  if (!params || typeof params !== 'object') {
    return actionResponse.badRequest('Invalid request payload.')
  }
  const { userId, delta, reason } = params
  if (typeof userId !== 'string' || !userId.trim()) {
    return actionResponse.badRequest('A valid user ID is required.')
  }
  if (typeof delta !== 'number' || !Number.isSafeInteger(delta) || delta === 0) {
    return actionResponse.badRequest('Delta must be a non-zero integer.')
  }
  const note = requireReason(reason)
  if (!note) {
    return actionResponse.badRequest('A reason is required.')
  }

  try {
    const buckets = await adjustCredits({
      userId,
      delta,
      note: `${note} (actor ${actor.userId})`,
    })
    return actionResponse.success(toUserCredits(buckets))
  } catch (error) {
    logger.error(
      {
        err: error,
        userId,
        delta,
        actorUserId: actor.userId,
      },
      'Failed to adjust user credits.'
    )
    return actionResponse.error('Failed to adjust credits.')
  }
}

/** Read a user's balances for the admin users table. */
export async function getUserCreditsForAdmin(params: {
  userId: string
}): Promise<ActionResult<UserCredits>> {
  if (!(await isAdmin())) return actionResponse.forbidden()

  try {
    return actionResponse.success(await getUserCredits(params.userId))
  } catch (error) {
    logger.error(
      { err: error, userId: params.userId },
      'Failed to load user credits for admin.'
    )
    return actionResponse.error('Failed to load user credits.')
  }
}

export interface AdminCreditTransactionItem {
  id: string
  /** Null after account deletion — the ledger is de-identified, not erased. */
  userId: string | null
  userEmail: string | null
  userName: string | null
  type: CreditTransactionType
  amount: number
  subscriptionCreditsAfter: number
  purchasedCreditsAfter: number
  note: string | null
  orderId: string | null
  createdAt: Date
}

/**
 * Global credit ledger for admin audit — one query serves both the
 * credits page (no userId) and the user-detail drilldown (userId set).
 */
export async function getAdminCreditTransactions(params: {
  pageIndex: number
  pageSize: number
  /** Restrict to one user (user-detail page) */
  userId?: string
  type?: CreditTransactionType
  /** Matches user email or ledger note (partial, case-insensitive) */
  search?: string
}): Promise<
  ActionResult<{ items: AdminCreditTransactionItem[]; total: number }>
> {
  if (!(await isAdmin())) return actionResponse.forbidden()

  const { pageIndex, pageSize, userId, type, search } = params
  const where = and(
    userId ? eq(creditTransactions.userId, userId) : undefined,
    type ? eq(creditTransactions.type, type) : undefined,
    search
      ? sql`(${ilike(userSchema.email, `%${search}%`)} OR ${ilike(
          creditTransactions.note,
          `%${search}%`
        )})`
      : undefined
  )

  try {
    const [items, [{ total }]] = await Promise.all([
      db
        .select({
          id: creditTransactions.id,
          userId: creditTransactions.userId,
          userEmail: userSchema.email,
          userName: userSchema.name,
          type: creditTransactions.type,
          amount: creditTransactions.amount,
          subscriptionCreditsAfter: creditTransactions.subscriptionCreditsAfter,
          purchasedCreditsAfter: creditTransactions.purchasedCreditsAfter,
          note: creditTransactions.note,
          orderId: creditTransactions.orderId,
          createdAt: creditTransactions.createdAt,
        })
        .from(creditTransactions)
        .leftJoin(userSchema, eq(creditTransactions.userId, userSchema.id))
        .where(where)
        // seq tiebreak: rows written in one transaction (cycle expire + grant)
        // share createdAt; insertion order must win.
        .orderBy(desc(creditTransactions.createdAt), desc(creditTransactions.seq))
        .limit(pageSize)
        .offset(pageIndex * pageSize),
      db
        .select({ total: count() })
        .from(creditTransactions)
        .leftJoin(userSchema, eq(creditTransactions.userId, userSchema.id))
        .where(where),
    ])

    return actionResponse.success({ items, total })
  } catch (error) {
    logger.error(
      {
        err: error,
        userId,
        transactionType: type,
      },
      'Failed to load admin credit transactions.'
    )
    return actionResponse.error('Failed to load credit transactions.')
  }
}

export interface BatchGrantResult {
  granted: { email: string; userId: string }[]
  notFoundEmails: string[]
}

/**
 * Grant the same amount of credits to a list of users by email — campaign
 * gifts, incident compensation. All grants share ONE transaction: either
 * every matched user is credited or none are. Unmatched emails are reported
 * back, never silently dropped.
 */
export async function grantCreditsToUsers(params: {
  emails: string[]
  amount: number
  reason: string
}): Promise<ActionResult<BatchGrantResult>> {
  const actor = await requireFreshAdmin()
  if (!actor) return actionResponse.forbidden()

  if (!params || typeof params !== 'object') {
    return actionResponse.badRequest('Invalid request payload.')
  }
  const { amount, reason } = params
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
    return actionResponse.badRequest('Amount must be a positive integer.')
  }
  const note = requireReason(reason)
  if (!note) {
    return actionResponse.badRequest('A reason is required.')
  }

  if (!Array.isArray(params.emails) || params.emails.some((e) => typeof e !== 'string')) {
    return actionResponse.badRequest('Recipient emails must be strings.')
  }
  const emails = Array.from(
    new Set(
      params.emails.map((e) => e.trim().toLowerCase()).filter(Boolean)
    )
  )
  if (emails.length === 0) {
    return actionResponse.badRequest('At least one email is required.')
  }
  if (emails.length > BATCH_GRANT_MAX_RECIPIENTS) {
    return actionResponse.badRequest(
      `At most ${BATCH_GRANT_MAX_RECIPIENTS} recipients per batch.`
    )
  }

  const actorNote = `${note} (actor ${actor.userId})`

  try {
    const recipients = await db
      .select({ id: userSchema.id, email: userSchema.email })
      .from(userSchema)
      .where(inArray(sql`lower(${userSchema.email})`, emails))

    const foundEmails = new Set(recipients.map((r) => r.email.toLowerCase()))
    const notFoundEmails = emails.filter((e) => !foundEmails.has(e))

    if (recipients.length > 0) {
      await runCommerceTransaction(async (commerce) => {
        for (const recipient of recipients) {
          await commerce.adjustCredits({ userId: recipient.id, delta: amount, note: actorNote })
        }
      })
    }

    return actionResponse.success({
      granted: recipients.map((r) => ({ email: r.email, userId: r.id })),
      notFoundEmails,
    })
  } catch (error) {
    logger.error(
      {
        err: error,
        amount,
        recipientCount: emails.length,
        actorUserId: actor.userId,
      },
      'Failed to grant credits to users.'
    )
    return actionResponse.error('Failed to grant credits.')
  }
}

interface AdminSingleBucketParams {
  userId: string
  bucket: AdminCreditBucket
  amount: number
  reason: string
}

async function runSingleBucket(
  op: 'add' | 'set' | 'deduct',
  params: AdminSingleBucketParams,
): Promise<ActionResult<UserCredits>> {
  const actor = await requireFreshAdmin()
  if (!actor) return actionResponse.forbidden()

  if (!params || typeof params !== 'object') {
    return actionResponse.badRequest('Invalid request payload.')
  }
  const { userId, bucket, amount, reason } = params
  if (typeof userId !== 'string' || !userId.trim()) {
    return actionResponse.badRequest('A valid user ID is required.')
  }
  if (bucket !== 'subscription' && bucket !== 'purchased') {
    return actionResponse.badRequest('Invalid bucket.')
  }
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) {
    return actionResponse.badRequest('Amount must be a non-negative integer.')
  }
  const note = requireReason(reason)
  if (!note) {
    return actionResponse.badRequest('A reason is required.')
  }

  try {
    const common = { userId, bucket, amount, actorUserId: actor.userId, reason: note }
    const buckets =
      op === 'add'
        ? await addCredits(common)
        : op === 'set'
          ? await setCredits(common)
          : await deductCredits(common)
    return actionResponse.success(toUserCredits(buckets))
  } catch (error) {
    logger.error(
      { err: error, userId, bucket, amount, op, actorUserId: actor.userId },
      `Failed to ${op} user credits.`,
    )
    return actionResponse.error(`Failed to ${op} credits.`)
  }
}

/** Add credits to one bucket (subscription or purchased), leaving the other intact. */
export async function addUserCredits(
  params: AdminSingleBucketParams,
): Promise<ActionResult<UserCredits>> {
  return runSingleBucket('add', params)
}

/**
 * Set one bucket to an exact amount, preserving the other bucket. Explicit 0
 * is valid and clears that bucket; an omitted amount is rejected, not treated
 * as 0.
 */
export async function setUserCredits(
  params: AdminSingleBucketParams,
): Promise<ActionResult<UserCredits>> {
  return runSingleBucket('set', params)
}

/** Deduct credits from one bucket, clamped at 0 (never the other bucket). */
export async function deductUserCredits(
  params: AdminSingleBucketParams,
): Promise<ActionResult<UserCredits>> {
  return runSingleBucket('deduct', params)
}
