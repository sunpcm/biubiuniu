/**
 * [INPUT]: Depends on @/lib/stripe's getStripe, @/lib/creem/client's
 *          createCreemCustomerPortalLink, @/lib/db and schema's
 *          user/subscriptions tables, @/lib/auth/server's
 *          getSession/getWorkspaceContext, @/lib/credits'
 *          ENTITLED_SUBSCRIPTION_STATUSES, next-intl/server's getLocale
 *          and @/i18n/routing's getPathname (locale prefix of the portal return URL)
 * [OUTPUT]: exports createCustomerPortalSession (server action)
 * [POS]: The subscription self-service entry point of actions/billing — finds
 *        the live subscription of the current billing subject (personal / team
 *        workspace) and dispatches on its provider: stripe → Billing Portal,
 *        creem → Creem Customer Portal, paypal → PayPal autopay page (no hosted
 *        portal); with no live subscription it falls back to the user's Stripe
 *        billing history (change card / view invoices); in a team workspace only
 *        the subscription purchaser may open the portal (a team subscription
 *        hangs off the purchaser's personal customer, so any member holding a
 *        session could see the card / cancel it — enforced server side, not by the UI)
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

'use server';

import { getPathname } from '@/i18n/routing';
import { actionResponse, ActionResult } from '@/lib/action-response';
import { getSession, getWorkspaceContext } from '@/lib/auth/server';
import { createCreemCustomerPortalLink } from '@/lib/creem/client';
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/credits';
import { db } from '@/lib/db';
import { subscriptions, user as userSchema } from '@/lib/db/schema';
import { getLogger } from '@/lib/logger';
import { getStripe, isStripeEnabled } from '@/lib/stripe';
import { getURL } from '@/lib/url';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { getLocale } from 'next-intl/server';

const logger = getLogger('billing.portal')

/** PayPal has no hosted subscription-management portal — users manage it inside their own PayPal account. */
const PAYPAL_AUTOPAY_URL = 'https://www.paypal.com/myaccount/autopay/'

/**
 * Returns a subscription-management URL for the signed-in customer,
 * dispatched on the live subscription's provider.
 */
export async function createCustomerPortalSession(): Promise<
  ActionResult<{ url: string }>
> {
  const session = await getSession()
  const user = session?.user
  if (!user) return actionResponse.unauthorized()

  // The billing subject follows the workspace: a team workspace manages the
  // org's subscription (opened by its purchaser), a personal workspace the
  // user's own. Same subject isolation as the checkout guard.
  const workspace = await getWorkspaceContext()
  const subjectPredicate = workspace?.organizationId
    ? eq(subscriptions.organizationId, workspace.organizationId)
    : and(
        eq(subscriptions.userId, user.id),
        isNull(subscriptions.organizationId)
      )

  const [liveSub] = await db
    .select({
      provider: subscriptions.provider,
      providerCustomerId: subscriptions.providerCustomerId,
      userId: subscriptions.userId,
    })
    .from(subscriptions)
    .where(
      and(
        subjectPredicate,
        inArray(subscriptions.status, ENTITLED_SUBSCRIPTION_STATUSES)
      )
    )
    .orderBy(desc(subscriptions.createdAt))
    .limit(1)

  // A team subscription hangs off the purchaser's personal provider customer —
  // a portal session exposes their card and full invoice history, and can cancel
  // or change the subscription. So in a team workspace only the purchaser may
  // open the portal (the same predicate as the team page's isSubscriptionPurchaser;
  // this is the server-side line of defense; once the purchaser has deleted their
  // account userId is null and everyone is refused).
  if (workspace?.organizationId && liveSub && liveSub.userId !== user.id) {
    return actionResponse.forbidden(
      'Only the subscription purchaser can manage team billing.'
    )
  }

  try {
    // Locale-prefixed return URL — under the as-needed strategy a bare path
    // means the default language, so non-English users coming back from the
    // portal would be flipped to English.
    const locale = await getLocale()
    const returnUrl = getURL(
      getPathname({ locale, href: '/dashboard/billing' })
    )

    if (liveSub?.provider === 'creem') {
      if (!liveSub.providerCustomerId) {
        return actionResponse.notFound(
          'No Creem billing account found for this subscription.'
        )
      }
      const url = await createCreemCustomerPortalLink(liveSub.providerCustomerId)
      return actionResponse.success({ url })
    }

    if (liveSub?.provider === 'paypal') {
      return actionResponse.success({ url: PAYPAL_AUTOPAY_URL })
    }

    // Stripe subscription — or no live subscription at all, in which case the
    // Stripe Billing Portal still serves past invoices / saved cards.
    if (!isStripeEnabled) {
      return actionResponse.error('Payments are not configured.')
    }

    const [row] = await db
      .select({ stripeCustomerId: userSchema.stripeCustomerId })
      .from(userSchema)
      .where(eq(userSchema.id, user.id))
      .limit(1)

    const stripeCustomerId =
      (liveSub?.provider === 'stripe' ? liveSub.providerCustomerId : null) ??
      row?.stripeCustomerId
    if (!stripeCustomerId) {
      return actionResponse.notFound('No billing account found for this user.')
    }

    const portal = await getStripe().billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    })
    return actionResponse.success({ url: portal.url })
  } catch (error) {
    logger.error(
      { err: error, userId: user.id, organizationId: workspace?.organizationId },
      'Failed to create customer portal session.'
    )
    return actionResponse.error('Failed to open the billing portal.')
  }
}
