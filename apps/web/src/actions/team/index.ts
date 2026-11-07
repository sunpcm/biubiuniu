/**
 * [INPUT]: Depends on @/lib/auth/server for getSession, @/lib/credits for
 *          getOrganizationBillingSummary and ENTITLED_SUBSCRIPTION_STATUSES,
 *          @/config/pricing for getPlanSeats, @/lib/db and schema for the
 *          member/invitation/subscriptions/creditTransactions/user tables
 * [OUTPUT]: Exports getTeamOverview (team overview: shared-pool billing summary +
 *           seat usage + pending invitation count + purchaser flag +
 *           hasTeamSubscription live-subscription flag — the same yardstick the
 *           invitation hook applies, so the render layer can predict whether
 *           inviting is available),
 *           getTeamCreditHistory (paginated org ledger, joined with the actor,
 *           a null userId = a deleted member), the TeamOverview /
 *           TeamCreditHistoryPage types
 * [POS]: The user-side entry point of actions/team — the only data layer of the
 *        team management page; every read is guarded by "the caller is a member
 *        of this organization"
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

'use server';

import { getPlanSeats } from '@/config/pricing';
import { actionResponse, ActionResult } from '@/lib/action-response';
import { getSession } from '@/lib/auth/server';
import type { BillingSummary } from '@/lib/credits';
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  getOrganizationBillingSummary,
} from '@/lib/credits';
import { db } from '@/lib/db';
import {
  creditTransactions,
  CreditTransactionType,
  invitation,
  member,
  subscriptions,
  user as userTable,
} from '@/lib/db/schema';
import { and, count, desc, eq, gt, inArray, ne } from 'drizzle-orm';

/** Membership guard: the caller's member row in the org, null if not one. */
async function getMembership(organizationId: string, userId: string) {
  const [row] = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(
      and(eq(member.organizationId, organizationId), eq(member.userId, userId))
    )
    .limit(1);
  return row ?? null;
}

export interface TeamOverview {
  /** Org shared-pool balances + team subscription (incl. dunning states). */
  billing: BillingSummary;
  /**
   * Seat usage: used = current member count, total comes from the live team
   * subscription's planId (ENTITLED, incl. dunning) — seats survive dunning
   * just like credits and retention, the same yardstick the invitation hook
   * applies server-side.
   */
  seats: { used: number; total: number };
  /** Unexpired pending invitations (they occupy seats in the server hook). */
  pendingInvitations: number;
  /** Whether the caller purchased the subscription — only the purchaser can manage it. */
  isSubscriptionPurchaser: boolean;
  /**
   * Whether the org holds a live team subscription (ENTITLED, incl. dunning)
   * — same verdict the invitation hook reaches: without a subscription every
   * invite gets a 403, so the frontend swaps the invite form for a purchase
   * prompt at render time instead of letting users submit into the hook.
   */
  hasTeamSubscription: boolean;
}

/** Team page overview: billing summary + seats + invite count. Caller must be an org member. */
export async function getTeamOverview(
  organizationId: string
): Promise<ActionResult<TeamOverview>> {
  const session = await getSession();
  const user = session?.user;
  if (!user) return actionResponse.unauthorized();
  if (!organizationId) {
    return actionResponse.badRequest('organizationId is required.');
  }

  try {
    const membership = await getMembership(organizationId, user.id);
    if (!membership) {
      return actionResponse.forbidden('Not a member of this organization.');
    }

    const [billing, [sub], [{ used }], [{ pending }]] = await Promise.all([
      getOrganizationBillingSummary(organizationId),
      // One query answers two questions: the seat cap (the ENTITLED
      // subscription's planId) and the purchaser identity (during dunning
      // the purchaser still needs the manage entry to fix payment).
      db
        .select({
          planId: subscriptions.planId,
          userId: subscriptions.userId,
        })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.organizationId, organizationId),
            inArray(subscriptions.status, ENTITLED_SUBSCRIPTION_STATUSES)
          )
        )
        .orderBy(desc(subscriptions.createdAt))
        .limit(1),
      db
        .select({ used: count() })
        .from(member)
        .where(eq(member.organizationId, organizationId)),
      db
        .select({ pending: count() })
        .from(invitation)
        .where(
          and(
            eq(invitation.organizationId, organizationId),
            eq(invitation.status, 'pending'),
            gt(invitation.expiresAt, new Date())
          )
        ),
    ]);

    return actionResponse.success({
      billing,
      seats: {
        used,
        total: getPlanSeats(sub?.planId),
      },
      pendingInvitations: pending,
      isSubscriptionPurchaser: sub?.userId === user.id,
      hasTeamSubscription: !!sub,
    });
  } catch (error) {
    console.error('getTeamOverview failed:', error);
    return actionResponse.error('Failed to load team overview.');
  }
}

export interface TeamCreditHistoryItem {
  id: string;
  type: CreditTransactionType;
  amount: number;
  subscriptionCreditsAfter: number;
  purchasedCreditsAfter: number;
  note: string | null;
  createdAt: Date;
  /** Actor snapshot; both null when the deletion hook SET NULL'd the userId. */
  actorName: string | null;
  actorEmail: string | null;
}

export interface TeamCreditHistoryPage {
  items: TeamCreditHistoryItem[];
  total: number;
}

/**
 * Paginated org ledger history (team activity). Only rows with
 * organizationId = this org — their balance snapshots belong to the team
 * pool and userId is the acting member; left join user fills in the actor's
 * name/email, deleted members get placeholder copy on the frontend.
 */
export async function getTeamCreditHistory(params: {
  organizationId: string;
  pageIndex: number;
  pageSize: number;
}): Promise<ActionResult<TeamCreditHistoryPage>> {
  const session = await getSession();
  const user = session?.user;
  if (!user) return actionResponse.unauthorized();

  const { organizationId, pageIndex, pageSize } = params;
  if (!organizationId) {
    return actionResponse.badRequest('organizationId is required.');
  }

  const where = and(
    eq(creditTransactions.organizationId, organizationId),
    // Cycle-expire rows are bookkeeping facts, not team activity: the grant
    // row already shows the full amount, surfacing the expiry would only
    // read as "our credits were taken" (same reasoning as getMyCreditHistory).
    ne(creditTransactions.type, 'subscription_cycle_expire')
  );

  try {
    const membership = await getMembership(organizationId, user.id);
    if (!membership) {
      return actionResponse.forbidden('Not a member of this organization.');
    }

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
          actorName: userTable.name,
          actorEmail: userTable.email,
        })
        .from(creditTransactions)
        .leftJoin(userTable, eq(creditTransactions.userId, userTable.id))
        .where(where)
        // seq tiebreak: rows written in one transaction share createdAt;
        // insertion order must win.
        .orderBy(
          desc(creditTransactions.createdAt),
          desc(creditTransactions.seq)
        )
        .limit(pageSize)
        .offset(pageIndex * pageSize),
      db.select({ total: count() }).from(creditTransactions).where(where),
    ]);

    return actionResponse.success({ items, total });
  } catch (error) {
    console.error('getTeamCreditHistory failed:', error);
    return actionResponse.error('Failed to load team credit history.');
  }
}
