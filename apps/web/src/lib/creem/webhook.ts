/**
 * [INPUT]: Depends on the Creem adapter fulfillment functions of
 *          @/lib/billing/creem, notifyCreditGrantFailed of @/lib/billing/notify,
 *          the event types of @/lib/creem/types, @/lib/api-response,
 *          @/lib/logger for sanitized diagnostics,
 *          creem/webhooks' verifyWebhookSignature (HMAC-SHA256, accepts both
 *          the three Standard Webhooks headers and the legacy single
 *          creem-signature header) / parseWebhookEvent /
 *          parseWebhookEventEntity (CREEM_WEBHOOK_SECRET)
 * [OUTPUT]: Exports POST (Creem webhook endpoint /api/creem/webhook)
 * [POS]: The only route of app/api/creem — verifies the signature, then
 *        dispatches the event to lib/billing/creem; carries no business logic
 *        itself. Unsubscribed event types are acked silently; handled types go
 *        through the SDK's strict parse (schema drift throws → 5xx, Creem
 *        retries with backoff within 24h and we alert). Transient/recoverable
 *        errors return 5xx so Creem retries automatically;
 *        PermanentFulfillmentError is alerted (deduplicated) and then acked so
 *        it never enters the retry loop; money events (checkout.completed /
 *        subscription.paid) additionally raise an email alert on failure;
 *        SDK/DB failures stay inside the shared privacy boundary and HTTP
 *        responses contain only stable provider-specific messages
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { apiResponse } from "@/lib/api-response";
import { createCreemBilling } from "@/lib/billing/creem";
import { PermanentFulfillmentError } from "@/lib/billing/fulfillment";
import { notifyCreditGrantFailed } from "@/lib/billing/notify";
import type { CreemAdapterDeps } from "@/lib/billing/creem";
import { getAppCommerce, type AppCommerce } from "@/composition/commerce";

export interface CreemWebhookDeps {
  secret?: string;
  adapter?: CreemAdapterDeps;
  logger?: AppLogger;
  notify?: typeof notifyCreditGrantFailed;
  app?: AppCommerce;
}

import type { CreemWebhookEventType } from "@/lib/creem/types";
import { getLogger, type AppLogger } from "@/lib/logger";
import { parseWebhookEvent, parseWebhookEventEntity, verifyWebhookSignature } from "creem/webhooks";

/** Events this route actually handles; other types are acked right after signature verification, never strictly parsed. */
const HANDLED_EVENTS: ReadonlySet<CreemWebhookEventType> = new Set<CreemWebhookEventType>([
  "checkout.completed",
  "subscription.paid",
  "subscription.active",
  "subscription.update",
  "subscription.trialing",
  "subscription.paused",
  "subscription.scheduled_cancel",
  "subscription.past_due",
  "subscription.unpaid",
  "subscription.canceled",
  "subscription.expired",
  "refund.created",
  "dispute.created",
]);

const MONEY_EVENTS: ReadonlySet<string> = new Set(["checkout.completed", "subscription.paid"]);

/** Minimal payload shape for alerting — only id and metadata from the raw JSON, independent of the strict parse. */
type RawEventObject = { id?: string; metadata?: Record<string, unknown> };

export function createCreemWebhookHandler(deps: CreemWebhookDeps = {}) {
  const logger = deps.logger ?? getLogger("billing.creem.webhook");
  const notify = deps.notify ?? notifyCreditGrantFailed;
  const billing = (deps.app ? Promise.resolve(deps.app) : getAppCommerce()).then(
    createCreemBilling,
  );

  return async function POST(req: Request) {
    const rawBody = await req.text();
    const secret = deps.secret ?? process.env.CREEM_WEBHOOK_SECRET;

    if (!secret) {
      logger.error({}, "CREEM_WEBHOOK_SECRET not configured");
      return apiResponse.serverError("Webhook secret not configured.");
    }

    try {
      await verifyWebhookSignature(rawBody, req.headers, { secret });
    } catch (error) {
      logger.warn({ err: error }, "Creem webhook signature verification failed");
      return apiResponse.badRequest("Signature verification failed.");
    }

    let envelope: ReturnType<typeof parseWebhookEvent<RawEventObject>>;
    try {
      envelope = parseWebhookEvent<RawEventObject>(rawBody);
    } catch {
      return apiResponse.badRequest("Invalid webhook payload.");
    }

    const eventType = envelope.type;
    if (!HANDLED_EVENTS.has(eventType as CreemWebhookEventType)) {
      return apiResponse.success({ received: true }); // unsubscribed event types are acknowledged silently
    }

    try {
      // Strict, typed parse (camelCase entities). A schema drift here is a
      // genuine "our code is stale" error: it 5xxs into Creem's retry window.
      const event = parseWebhookEventEntity(rawBody);
      const selected = await billing;
      const fulfillmentDeps: CreemAdapterDeps = {
        ...deps.adapter,
        webhookSecret: deps.adapter?.webhookSecret ?? secret,
      };

      switch (event.eventType) {
        case "checkout.completed":
          await selected.fulfillCreemCheckout(event.object, fulfillmentDeps);
          break;

        case "subscription.paid":
          await selected.fulfillCreemSubscriptionPaid(event.object, fulfillmentDeps);
          break;

        case "subscription.active":
        case "subscription.update":
        case "subscription.trialing":
        case "subscription.paused":
        case "subscription.scheduled_cancel":
        case "subscription.past_due":
        case "subscription.unpaid":
          await selected.syncCreemSubscription(event.object, fulfillmentDeps);
          break;

        case "subscription.canceled":
        case "subscription.expired":
          await selected.handleCreemSubscriptionEnded(event.object, fulfillmentDeps);
          break;

        case "refund.created":
          await selected.applyCreemRefund(event.object, fulfillmentDeps);
          break;

        case "dispute.created":
          await selected.handleCreemDispute(event.object);
          break;
      }
      return apiResponse.success({ received: true });
    } catch (error) {
      logger.error({ eventType, err: error }, "Creem webhook handler failed");

      // A failed fulfillment rolls back atomically (no order, no credits) and
      // Creem will retry — but a paying user is waiting, so page the admin.
      if (MONEY_EVENTS.has(eventType)) {
        const metadata = envelope.data?.metadata ?? {};
        await notify({
          userId: typeof metadata.userId === "string" ? metadata.userId : "unknown",
          orderId: envelope.data?.id ?? "unknown",
          planId: typeof metadata.planId === "string" ? metadata.planId : "unknown",
          error,
        });
      }

      // A permanent business error (buyer account deleted, etc.) will never
      // succeed on retry — the alert is already out, so ack it and keep it out of
      // the retry loop; recoverable errors still 5xx to keep the self-heal window.
      if (error instanceof PermanentFulfillmentError) {
        return apiResponse.success({ received: true, permanentError: true });
      }

      // 5xx makes Creem retry with backoff — our handlers are idempotent.
      return apiResponse.serverError("Failed to process Creem webhook.");
    }
  };
}
