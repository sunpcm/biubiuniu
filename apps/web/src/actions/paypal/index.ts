/**
 * [INPUT]: Depends on @/lib/auth/server's getSession, @/lib/db and schema's
 *          subscriptions table, @/lib/paypal's cancelPayPalSubscription,
 *          @/lib/billing/paypal's syncPayPalSubscriptionById,
 *          @/lib/action-response
 * [OUTPUT]: exports cancelPayPalSubscriptionAction (server action)
 * [POS]: The only action in actions/paypal — PayPal has no hosted portal, so
 *        cancelling can only go through the API: after an ownership check (the
 *        purchaser on the local subscription row = the current user) it calls
 *        PayPal to cancel, then syncs back from the source so the UI reflects it
 *        immediately; the termination path (stop drip / clear buckets) is closed
 *        out by the BILLING.SUBSCRIPTION.CANCELLED webhook. Saving the payer id
 *        and syncing subscriptions are no longer public actions — they belong
 *        exclusively to the lib/billing/paypal adapter
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

'use server';

import { actionResponse, ActionResult } from '@/lib/action-response';
import { getSession } from '@/lib/auth/server';
import { syncPayPalSubscriptionById } from '@/lib/billing/paypal';
import { db } from '@/lib/db';
import { subscriptions } from '@/lib/db/schema';
import { getLogger } from '@/lib/logger';
import { cancelPayPalSubscription } from '@/lib/paypal';
import { and, eq } from 'drizzle-orm';

const logger = getLogger('billing.paypal.cancel-action')

/**
 * Cancel a PayPal subscription (effective immediately — PayPal has no notion of
 * cancel_at_period_end).
 */
export async function cancelPayPalSubscriptionAction(
  subscriptionId: string,
  reason?: string
): Promise<ActionResult<{ canceled: boolean }>> {
  const session = await getSession()
  const user = session?.user
  if (!user) {
    return actionResponse.unauthorized()
  }

  // Ownership check: only the purchaser on the local subscription row may
  // cancel it (for a team subscription the purchaser IS the billing owner;
  // organization members have no say over it).
  const [row] = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.provider, 'paypal'),
        eq(subscriptions.providerSubscriptionId, subscriptionId)
      )
    )
    .limit(1)

  if (!row) {
    return actionResponse.notFound('Subscription not found.')
  }
  if (row.userId !== user.id) {
    return actionResponse.forbidden(
      'Only the subscription owner can cancel it.'
    )
  }

  try {
    await cancelPayPalSubscription(subscriptionId, reason)
  } catch (error) {
    logger.error(
      { err: error, subscriptionId, userId: user.id },
      'Failed to cancel PayPal subscription.'
    )
    return actionResponse.error(
      'Failed to cancel the subscription. Please try again or contact support.'
    )
  }

  // Syncing back from the source lets the UI see "canceled" right away; the
  // termination semantics (stop drip / clear buckets) are backstopped by the
  // BILLING.SUBSCRIPTION.CANCELLED webhook via the core termination path.
  try {
    await syncPayPalSubscriptionById(subscriptionId)
  } catch (syncError) {
    logger.error(
      { err: syncError, subscriptionId, userId: user.id },
      'Post-cancel PayPal subscription sync failed; the webhook will reconcile it.'
    )
  }

  return actionResponse.success({ canceled: true })
}
