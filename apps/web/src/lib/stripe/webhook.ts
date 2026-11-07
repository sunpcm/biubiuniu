/**
 * [INPUT]: Depends on @/lib/stripe for the stripe client, @/lib/billing/stripe
 *          for the Stripe adapter's fulfillment functions, @/lib/billing/notify
 *          for email notifications, @/lib/logger for sanitized diagnostics,
 *          @/lib/api-response
 * [OUTPUT]: Exports POST (Stripe webhook endpoint /api/stripe/webhook)
 * [POS]: The only route in app/api/stripe — verifies the signature, then
 *        dispatches the event to lib/billing/stripe and holds no business
 *        logic of its own; transient/fixable errors return 5xx so Stripe
 *        retries automatically (fulfillment catches up once a fix is
 *        deployed), while a PermanentFulfillmentError (the buyer's account is
 *        deleted and other errors where retrying can never succeed) is
 *        alerted (deduped) and then acked so it never enters the retry loop;
 *        SDK/DB failures are logged through the shared privacy boundary and
 *        HTTP responses expose only stable provider-specific messages
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { apiResponse } from "@/lib/api-response";
import { PermanentFulfillmentError } from "@/lib/billing/fulfillment";
import { notifyCreditGrantFailed } from "@/lib/billing/notify";
import { createStripeBilling } from "@/lib/billing/stripe";
import { getLogger, type AppLogger } from "@/lib/logger";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";
import type { StripeCheckoutDeps } from "@/lib/billing/stripe";
import { getAppCommerce, type AppCommerce } from "@/composition/commerce";

export interface StripeWebhookDeps {
  client?: Pick<Stripe, "webhooks">;
  secret?: string;
  adapter?: StripeCheckoutDeps;
  logger?: AppLogger;
  notify?: typeof notifyCreditGrantFailed;
  app?: AppCommerce;
}

export function createStripeWebhookHandler(deps: StripeWebhookDeps = {}) {
  const logger = deps.logger ?? getLogger("billing.stripe.webhook");
  const notify = deps.notify ?? notifyCreditGrantFailed;
  const billing = (deps.app ? Promise.resolve(deps.app) : getAppCommerce()).then(
    createStripeBilling,
  );

  return async function POST(req: Request) {
    const body = await req.text();
    const sig = req.headers.get("stripe-signature");
    const webhookSecret = deps.secret ?? process.env.STRIPE_WEBHOOK_SECRET;
    const client = deps.client ?? stripe;

    if (!sig || !webhookSecret) {
      return apiResponse.badRequest("Webhook secret not configured");
    }
    if (!client) {
      return apiResponse.serverError("Stripe is not initialized");
    }

    let event: Stripe.Event;
    try {
      event = client.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err) {
      logger.warn({ err }, "Stripe webhook signature verification failed");
      return apiResponse.badRequest("Webhook signature verification failed.");
    }

    try {
      const selected = await billing;
      const fulfillmentDeps: StripeCheckoutDeps = {
        ...deps.adapter,
        client: deps.adapter?.client ?? client,
        webhookSecret: deps.adapter?.webhookSecret ?? webhookSecret,
      };
      switch (event.type) {
        case "checkout.session.completed":
          await selected.fulfillCheckoutSession(event.data.object, fulfillmentDeps);
          break;

        case "invoice.paid":
          await selected.fulfillInvoicePaid(event.data.object, fulfillmentDeps);
          break;

        case "customer.subscription.created":
        case "customer.subscription.updated":
          await selected.syncStripeSubscription(event.data.object, fulfillmentDeps);
          break;

        case "customer.subscription.deleted":
          await selected.handleSubscriptionDeleted(event.data.object, fulfillmentDeps);
          break;

        case "charge.refunded":
          await selected.applyRefundForCharge(event.data.object, fulfillmentDeps);
          break;

        case "invoice.payment_failed":
          await selected.handleInvoicePaymentFailed(event.data.object, fulfillmentDeps);
          break;

        case "radar.early_fraud_warning.created":
          await selected.handleEarlyFraudWarning(event.data.object);
          break;

        default:
          break; // unsubscribed event types are acknowledged silently
      }
      return apiResponse.success({ received: true });
    } catch (error) {
      logger.error({ eventType: event.type, err: error }, "Stripe webhook handler failed");

      // A failed fulfillment rolls back atomically (no order, no credits) and
      // Stripe will retry — but a paying user is waiting, so page the admin
      // (deduped per object: retries and the reconcile cron only log).
      if (event.type === "checkout.session.completed" || event.type === "invoice.paid") {
        const object = event.data.object as {
          id: string;
          metadata?: Stripe.Metadata | null;
        };
        await notify({
          userId: object.metadata?.userId ?? "unknown",
          orderId: object.id,
          planId: object.metadata?.planId ?? "unknown",
          error,
        });
      }

      // Retrying a permanent business error (the buyer deleted their account,
      // etc.) can never succeed — the alert is already out, so ack it instead of
      // letting Stripe hammer for 3 days for nothing; fixable errors such as a
      // failed plan lookup still return 5xx to keep the retry window open
      // (fulfillment catches up once a fix is deployed).
      if (error instanceof PermanentFulfillmentError) {
        return apiResponse.success({ received: true, permanentError: true });
      }

      // 5xx makes Stripe retry with backoff — our handlers are idempotent.
      return apiResponse.serverError("Failed to process Stripe webhook.");
    }
  };
}
