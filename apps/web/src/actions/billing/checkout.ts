/**
 * [INPUT]: Depends on @/config/pricing for plan config and getAutoPromotionCode,
 *          @/lib/billing/customer for getOrCreateStripeCustomer, @/lib/stripe,
 *          @/lib/creem/client for createCreemCheckoutSession/creemMode,
 *          @/lib/paypal for createPayPalSubscription,
 *          @/lib/auth/server for getSession/getWorkspaceContext, @/lib/credits
 *          for ENTITLED_SUBSCRIPTION_STATUSES (source of truth for the
 *          "live subscription" definition), next-intl/server's getLocale and
 *          @/i18n/routing's getPathname (locale prefix of payment return URLs)
 * [OUTPUT]: Exports createCheckoutSession (server action)
 * [POS]: Checkout entry of actions/billing — the pricing page's only purchase
 *        channel; subscriptions and credit packs share one action, the mode is
 *        decided by the plan kind and the provider by the plan's provider
 *        (stripe → Checkout Session, creem → Creem Checkout, paypal →
 *        subscriptions only via Billing Subscription, credit packs are carried
 *        by the pricing page's PayPal button flow); credit packs land only in
 *        the personal purchased bucket: forbidden in a team workspace
 *        (TEAM_WORKSPACE_CREDIT_PACK, the client prompts a switch back to the
 *        personal workspace); team-plan organization resolution: explicit
 *        param → active workspace org (must be owner) → the single owned org →
 *        ORGANIZATION_REQUIRED only when undecidable; the single-subscription
 *        guard is isolated per billing subject (personal and org never occupy
 *        each other's slot, ENTITLED semantics — past_due/unpaid still hold
 *        the slot, dunning users recover through the Portal);
 *        defense #1: before a Stripe subscription checkout, expire all of this
 *        customer's open subscription sessions, closing at the source the 24h
 *        window of "paying a stale session creates a double subscription"
 *        (fulfillment-side defense #2 = fulfillment's first-writer-wins +
 *        automatic-refund backstop);
 *        a configured campaign/plan promotion code is applied automatically at
 *        checkout (falls back to the manual input when invalid);
 *        success/cancel return URLs carry the current locale prefix — under
 *        the as-needed strategy the URL prefix is the sole carrier of the
 *        language; losing it = coming back from payment switched to English
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use server";

import {
  getAutoPromotionCode,
  getPlanById,
  isSubscriptionPlan,
  isTeamPlan,
  type PricingPlan,
} from "@/config/pricing";
import { getPathname } from "@/i18n/routing";
import { isPurchaseEnabled } from "@/config/features";
import { PRICING_PATH } from "@/config/public-paths";
import { actionResponse, ActionResult } from "@/lib/action-response";
import { getSession, getWorkspaceContext } from "@/lib/auth/server";
import { getOrCreateStripeCustomer } from "@/lib/billing/customer";
import { createCreemCheckoutSession, creemMode, isCreemEnabled } from "@/lib/creem/client";
import { ENTITLED_SUBSCRIPTION_STATUSES } from "@/lib/credits";
import { db } from "@/lib/db";
import { member, subscriptions } from "@/lib/db/schema";
import { getLogger } from "@/lib/logger";
import { createPayPalSubscription, isPayPalEnabled } from "@/lib/paypal";
import { getStripe, getStripePriceId, isStripeEnabled } from "@/lib/stripe";
import { getURL } from "@/lib/url";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getLocale } from "next-intl/server";

const logger = getLogger("billing.checkout");

/**
 * Resolves a configured customer-facing promotion code (e.g. 'LAUNCH20') to
 * Stripe checkout discounts. Returns undefined when no code is configured or
 * the code is inactive/absent in the current mode — checkout then falls back
 * to the manual promo-code input, never fails because of a stale campaign.
 */
async function resolveAutoDiscount(
  plan: PricingPlan,
): Promise<{ promotion_code: string }[] | undefined> {
  const code = getAutoPromotionCode(plan);
  if (!code) return undefined;

  try {
    const { data } = await getStripe().promotionCodes.list({
      code,
      active: true,
      limit: 1,
    });
    if (!data[0]) {
      logger.warn(
        { planId: plan.id },
        "Automatic promotion code was not found or is inactive.",
      );
      return undefined;
    }
    return [{ promotion_code: data[0].id }];
  } catch (error) {
    logger.error(
      { err: error, planId: plan.id },
      "Failed to resolve automatic promotion code.",
    );
    return undefined;
  }
}

/**
 * Creates a checkout for a plan and returns its redirect URL.
 * Provider-agnostic guards run first; the tail dispatches on plan.provider.
 */
export async function createCheckoutSession(params: {
  planId: string;
  /** Required for team plans: the organization the subscription entitles. */
  organizationId?: string;
  /** Affiliate id from window.tolt_referral — lands in Stripe metadata */
  toltReferral?: string;
}): Promise<ActionResult<{ url: string }>> {
  // New purchase entry is closed for this task: the durable-task contract
  // (plan §5.4) is not yet shipped, so no payment provider is contacted and no
  // subscription/order is created. Re-enable only once the contract ships.
  if (!isPurchaseEnabled()) {
    return actionResponse.error("Checkout is not available yet.", "CHECKOUT_DISABLED");
  }

  const session = await getSession();
  const user = session?.user;
  if (!user) {
    return actionResponse.unauthorized("User not authenticated.", "UNAUTHORIZED");
  }

  const plan = getPlanById(params.planId);
  if (!plan || plan.active === false) {
    return actionResponse.badRequest(`Unknown plan: ${params.planId}`);
  }

  // Credit packs are personal assets and land only in the buyer's personal
  // purchased bucket; the only money-inflow into a team pool is subscription
  // grants. Letting the purchase through in a team workspace would mean
  // "paid, yet the current workspace balance never moves" — forbid it
  // outright and prompt a switch back to the personal workspace. The client
  // renders the guidance copy off the customCode.
  if (plan.kind === "credit_pack") {
    const workspace = await getWorkspaceContext();
    if (workspace?.organizationId) {
      return actionResponse.conflict(
        "Credit packs are personal purchases. Switch to your personal workspace to buy one.",
        "TEAM_WORKSPACE_CREDIT_PACK",
      );
    }
  }

  // Team plans bill an organization: only its owner may subscribe it, and
  // the org id must be pinned before checkout so fulfillment knows the pool.
  // Resolution order: explicit param → active workspace org (when the caller
  // owns it) → the single owned org. Only a genuinely ambiguous caller (no
  // owned org, or several owned orgs while sitting in a personal workspace)
  // gets ORGANIZATION_REQUIRED — the client routes to the team page then.
  let organizationId: string | undefined;
  if (isTeamPlan(plan)) {
    const owned = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(and(eq(member.userId, user.id), eq(member.role, "owner")));
    const ownedIds = new Set(owned.map((o) => o.organizationId));

    if (params.organizationId) {
      if (!ownedIds.has(params.organizationId)) {
        return actionResponse.forbidden("Only the organization owner can purchase a team plan.");
      }
      organizationId = params.organizationId;
    } else {
      const workspace = await getWorkspaceContext();
      if (workspace?.organizationId && ownedIds.has(workspace.organizationId)) {
        organizationId = workspace.organizationId;
      } else if (ownedIds.size === 1) {
        organizationId = owned[0].organizationId;
      } else {
        return actionResponse.badRequest(
          "A team plan requires an organization.",
          "ORGANIZATION_REQUIRED",
        );
      }
    }
  }

  // One live subscription per subject: grants RESET the subject's bucket, so
  // two concurrent subscriptions would overwrite each other's credits. The
  // subject is the org for team plans, the user for personal plans — a
  // personal subscription and a team subscription never contend. Plan
  // changes go through the provider portal instead. "Live" is the ENTITLED
  // set: a past_due/unpaid subscription still occupies the slot (the
  // provider keeps retrying and may recover) — dunning users fix payment in
  // the portal instead of stacking a second subscription.
  if (isSubscriptionPlan(plan)) {
    const [liveSub] = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          organizationId
            ? eq(subscriptions.organizationId, organizationId)
            : and(eq(subscriptions.userId, user.id), isNull(subscriptions.organizationId)),
          inArray(subscriptions.status, ENTITLED_SUBSCRIPTION_STATUSES),
        ),
      )
      .limit(1);
    if (liveSub) {
      return actionResponse.conflict(
        "You already have an active subscription. Manage or change your plan from the billing portal.",
        "SUBSCRIPTION_EXISTS",
      );
    }
  }

  // Under the as-needed prefix strategy the URL prefix is the sole carrier
  // of the locale (no cookie fallback when localeDetection is off): a
  // prefix-less return URL flips non-English users back to the default
  // language after payment.
  const locale = await getLocale();
  const successPath = getPathname({ locale, href: "/payment/success" });
  const cancelUrl = getURL(
    getPathname({
      locale,
      href: PRICING_PATH,
    }),
  );

  try {
    switch (plan.provider) {
      // ------------------------------------------------------------------
      // Stripe — Checkout Session (mode decided by the plan kind)
      // ------------------------------------------------------------------
      case "stripe": {
        if (!isStripeEnabled) {
          return actionResponse.error("Stripe payments are not configured.");
        }

        const customerId = await getOrCreateStripeCustomer({
          userId: user.id,
          email: user.email,
          name: user.name,
        });

        // Defense #1: expire this customer's leftover unpaid subscription
        // sessions first. A Stripe checkout session stays payable for ~24h —
        // paying a stale one after the user has bought another subscription
        // creates a double subscription (fulfillment-side defense #2 refunds it,
        // but close the source when you can). Expire regardless of billing
        // subject: collateral damage costs no more than reopening checkout
        // once. A failure here does not block checkout.
        if (isSubscriptionPlan(plan)) {
          try {
            const open = await getStripe().checkout.sessions.list({
              customer: customerId,
              status: "open",
              limit: 100,
            });
            await Promise.all(
              open.data
                .filter((s) => s.mode === "subscription")
                .map((s) =>
                  getStripe()
                    .checkout.sessions.expire(s.id)
                    .catch(() => {}),
                ),
            );
          } catch (error) {
            logger.warn(
              { err: error, userId: user.id },
              "Failed to expire stale checkout sessions; continuing checkout.",
            );
          }
        }

        // Team subscriptions hang on the purchaser's personal Stripe
        // customer — there is no org-level customer, and the Billing Portal
        // is opened by the purchaser. metadata.organizationId is what routes
        // fulfillment to the org pool, pinned here on all three copies
        // (session/subscription/PI).
        const metadata: Record<string, string> = {
          userId: user.id,
          planId: plan.id,
          ...(organizationId ? { organizationId } : {}),
          ...(params.toltReferral ? { tolt_referral: params.toltReferral } : {}),
        };
        const isSubscription = isSubscriptionPlan(plan);
        const discounts = await resolveAutoDiscount(plan);

        // The session_id placeholder is string-concatenated by hand —
        // {CHECKOUT_SESSION_ID} must reach Stripe as a literal and must not
        // be URL-escaped through query serialization.
        const checkout = await getStripe().checkout.sessions.create({
          customer: customerId,
          mode: isSubscription ? "subscription" : "payment",
          line_items: [{ price: getStripePriceId(plan), quantity: 1 }],
          // Stripe forbids combining `discounts` with `allow_promotion_codes`
          // — an auto-applied campaign replaces the manual input.
          ...(discounts ? { discounts } : { allow_promotion_codes: true }),
          // EU/UK right-of-withdrawal waiver: the consent notice for
          // immediate fulfillment of digital content must sit next to the
          // payment action, consistent with the refund policy's "EU and UK
          // Consumers" clause.
          custom_text: {
            submit: {
              message:
                "Credits are delivered immediately after payment. By purchasing you agree to our Terms of Service and Refund Policy, and acknowledge that once credits are used, the statutory 14-day right of withdrawal no longer applies to the used portion.",
            },
          },
          metadata,
          ...(isSubscription
            ? {
                subscription_data: {
                  metadata,
                  ...(plan.trialDays ? { trial_period_days: plan.trialDays } : {}),
                },
              }
            : {
                payment_intent_data: { metadata },
                // For one-time payments Stripe does not create a customer
                // link automatically; invoice creation keeps a paper trail.
                invoice_creation: { enabled: true },
              }),
          success_url: getURL(`${successPath}?session_id={CHECKOUT_SESSION_ID}`),
          cancel_url: cancelUrl,
        });

        if (!checkout.url) {
          return actionResponse.error("Stripe did not return a checkout URL.");
        }
        return actionResponse.success({ url: checkout.url });
      }

      // ------------------------------------------------------------------
      // Creem — hosted checkout; Creem appends checkout_id and friends to
      // the return URL itself
      // ------------------------------------------------------------------
      case "creem": {
        if (!isCreemEnabled) {
          return actionResponse.error("Creem payments are not configured.");
        }
        const productId = plan.creemProductId?.[creemMode];
        if (!productId) {
          return actionResponse.error(
            `Plan ${plan.id} has no Creem product id for ${creemMode} mode.`,
          );
        }

        const checkout = await createCreemCheckoutSession({
          productId,
          units: 1,
          ...(getAutoPromotionCode(plan) ? { discountCode: getAutoPromotionCode(plan) } : {}),
          customer: { email: user.email },
          successUrl: getURL(`${successPath}?provider=creem`),
          metadata: {
            userId: user.id,
            planId: plan.id,
            ...(organizationId ? { organizationId } : {}),
            ...(params.toltReferral ? { tolt_referral: params.toltReferral } : {}),
          },
        });

        if (!checkout?.checkoutUrl) {
          return actionResponse.error("Creem did not return a checkout URL.");
        }
        return actionResponse.success({ url: checkout.checkoutUrl });
      }

      // ------------------------------------------------------------------
      // PayPal — subscriptions only; credit packs are carried by the pricing
      // page's PayPal button flow (create-order/capture-order), not by this
      // action
      // ------------------------------------------------------------------
      case "paypal": {
        if (!isPayPalEnabled) {
          return actionResponse.error("PayPal payments are not configured.");
        }
        if (!isSubscriptionPlan(plan)) {
          return actionResponse.badRequest(
            "PayPal credit packs are purchased through the PayPal button on the pricing page.",
            "PAYPAL_CREDIT_PACK_BUTTON",
          );
        }

        const paypalMode: "test" | "live" =
          process.env.NEXT_PUBLIC_PAYPAL_ENVIRONMENT === "live" ? "live" : "test";
        const paypalPlanId = plan.paypalPlanId?.[paypalMode];
        if (!paypalPlanId) {
          return actionResponse.error(
            `Plan ${plan.id} has no PayPal plan id for ${paypalMode} mode.`,
          );
        }

        const subscription = await createPayPalSubscription({
          planId: paypalPlanId,
          subscriberEmail: user.email,
          customIdData: {
            userId: user.id,
            planId: plan.id,
            submitProductId: null,
            organizationId: organizationId ?? null,
          },
          returnUrl: getURL(`${successPath}?provider=paypal`),
          cancelUrl,
        });

        const approvalLink = subscription.links?.find((link) => link.rel === "approve");
        if (!approvalLink?.href) {
          return actionResponse.error("Failed to get PayPal approval URL.");
        }
        return actionResponse.success({ url: approvalLink.href });
      }
    }
  } catch (error) {
    logger.error(
      { err: error, planId: plan.id, provider: plan.provider, organizationId },
      "Failed to create checkout session.",
    );
    return actionResponse.error("Failed to create checkout session.");
  }
}
