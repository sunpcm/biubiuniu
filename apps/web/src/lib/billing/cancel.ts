/**
 * [INPUT]: Depends on getStripe from @/lib/stripe, cancelCreemSubscription
 *          from @/lib/creem/client, cancelPayPalSubscription from
 *          @/lib/paypal, PaymentProvider from @/config/pricing, and the
 *          shared privacy-aware logger
 * [OUTPUT]: Exports cancelProviderSubscription
 * [POS]: The provider-side subscription cancel funnel of lib/billing — the only
 *        implementation of "cancel + tolerate already cancelled", shared by the
 *        full-refund path and the duplicate-subscription refund path (all three
 *        adapters); the core (fulfillment) never calls back into a provider
 *        API — every network call lives in this layer
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import type { PaymentProvider } from "@/config/pricing";
import { getLogger } from "@/lib/logger";

const logger = getLogger("billing.cancel");

// ----------------------------------------------------------------------------
// "Already cancelled" is not a failure — the target state is reached. How each
// SDK words a repeated cancel: Stripe says No such subscription / already
// canceled; Creem says "Subscription does not exist" / "cannot be canceled in
// state: canceled"; PayPal returns 422 SUBSCRIPTION_STATUS_INVALID when
// cancelling a subscription that is already in a terminal state.
// ----------------------------------------------------------------------------
const ALREADY_GONE: Record<PaymentProvider, RegExp> = {
  stripe: /No such subscription|canceled/i,
  creem: /not found|does not exist|canceled|cancelled/i,
  paypal: /SUBSCRIPTION_STATUS_INVALID|UNPROCESSABLE|422/i,
};

/**
 * Cancels the subscription on the provider side. Returns true when the provider
 * side is now terminal (this cancel succeeded, or it had been cancelled long
 * ago); a genuine failure is logged and returns false — it never throws, since
 * a failed cancel must not turn the webhook into a 5xx (the money event itself
 * is already fully processed).
 */
export async function cancelProviderSubscription(
  provider: PaymentProvider,
  providerSubscriptionId: string,
  reason: string,
): Promise<boolean> {
  try {
    if (provider === "stripe") {
      const { getStripe } = await import("@/lib/stripe");
      await getStripe().subscriptions.cancel(providerSubscriptionId);
    } else if (provider === "creem") {
      const { cancelCreemSubscription } = await import("@/lib/creem/client");
      await cancelCreemSubscription(providerSubscriptionId);
    } else {
      const { cancelPayPalSubscription } = await import("@/lib/paypal/client");
      await cancelPayPalSubscription(providerSubscriptionId, reason);
    }
    return true;
  } catch (error) {
    if (error instanceof Error && ALREADY_GONE[provider].test(error.message)) {
      return true;
    }
    logger.error(
      { provider, providerSubscriptionId, reason, err: error },
      "Failed to cancel provider subscription",
    );
    return false;
  }
}
