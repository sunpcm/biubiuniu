/**
 * [INPUT]: Depends on @/lib/auth/server for getSession, @/lib/paypal for
 *          capturePayPalOrder/getPayPalOrder/decodePayPalCustomId/
 *          isPayPalEnabled, @/lib/billing/paypal for fulfillPayPalCapture/
 *          recordPendingPayPalCapture, @/lib/discord/notifications for
 *          notifyPendingPayment, @/config/pricing for getPlanName,
 *          next-intl/server for getLocale, @/lib/logger for sanitized
 *          diagnostics, @/lib/api-response,
 *          next/server for after
 * [OUTPUT]: Exports POST (/api/paypal/capture-order), takes {orderId},
 *           returns {success:true, data:{orderId, planName, pending?, message?}}
 * [POS]: The capture route of app/api/paypal — second hop of the
 *        PayPalCheckoutButton flow and the synchronous source of truth for
 *        fulfillment (webhook PAYMENT.CAPTURE.COMPLETED is the idempotent
 *        fallback): settlement truth lives in the capture-level status (the
 *        order-level enum has no PENDING; with eCheck the order is COMPLETED
 *        while the capture is PENDING — never decide granting from the order
 *        level): capture COMPLETED -> fulfillPayPalCapture records the order
 *        and grants credits immediately; PENDING -> recordPendingPayPalCapture
 *        writes a status='pending' 0-credit paper-trail row (visible to the
 *        user and the admin console, traceable by the reconcile cron) plus a
 *        Discord alert; on settlement the webhook promotes it in place and
 *        grants credits, and the success page can self-heal by re-verifying
 *        via order_id; a duplicate capture recovers through getPayPalOrder,
 *        with the idempotency key guarding against double fulfillment;
 *        provider/DB failures are logged through the privacy boundary and
 *        callers receive a stable capture error after authorization checks
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { getPlanName } from "@/config/pricing";
import { apiResponse } from "@/lib/api-response";
import { createPayPalBilling, selectedPayPalApp } from "@/lib/billing/paypal";
import { createPayPalSourceBilling } from "@/lib/billing/paypal-source";
import { notifyPendingPayment } from "@/lib/discord/notifications";
import { getLogger, type AppLogger } from "@/lib/logger";
import type { AppCommerce } from "@/composition/commerce";
import {
  capturePayPalOrder,
  decodePayPalCustomId,
  getPayPalOrder,
  isPayPalEnabled,
} from "@/lib/paypal";
import type { PayPalPayer, PayPalPurchaseUnit } from "@/lib/paypal/types";
import { getLocale } from "next-intl/server";
import type { PayPalAdapterDeps } from "@/lib/billing/paypal";

export interface PayPalCaptureDeps {
  getFreshSession: () => Promise<{ user: { id: string } } | null>;
  captureOrder?: typeof capturePayPalOrder;
  getOrder?: typeof getPayPalOrder;
  adapter?: PayPalAdapterDeps;
  getLocale?: () => Promise<string>;
  schedule?: (task: () => void) => void;
  logger?: AppLogger;
  app?: AppCommerce;
}
import { after } from "next/server";

/** The downstream shape shared by the capture and order responses. */
interface CaptureLikeResult {
  status: string;
  purchase_units: PayPalPurchaseUnit[];
  payer?: PayPalPayer;
}

/**
 * Capture, falling back to the original order on failure: a double click or a
 * refresh makes the second capture return 422 (ORDER_ALREADY_CAPTURED), and by
 * then the original order is already COMPLETED — use it to continue through
 * idempotent fulfillment instead of throwing a paid user onto an error page.
 */
async function captureOrRecover(
  orderId: string,
  deps: PayPalCaptureDeps,
): Promise<CaptureLikeResult> {
  try {
    return await (deps.captureOrder ?? capturePayPalOrder)(orderId);
  } catch (captureError) {
    const order = await (deps.getOrder ?? getPayPalOrder)(orderId).catch(() => null);
    if (order?.status === "COMPLETED") {
      (deps.logger ?? getLogger("billing.paypal.capture")).warn(
        { orderId },
        "PayPal order was already captured; recovering from order lookup",
      );
      return order;
    }
    throw captureError;
  }
}

export function createPayPalCaptureHandler(deps: PayPalCaptureDeps) {
  const logger = deps.logger ?? getLogger("billing.paypal.capture");
  const app = deps.app ? Promise.resolve(deps.app) : selectedPayPalApp();
  const billing = app.then(createPayPalBilling);
  const sourceBilling = app.then(createPayPalSourceBilling);

  return async function POST(req: Request) {
    const session = await deps.getFreshSession();
    const user = session?.user;
    if (!user) {
      return apiResponse.unauthorized();
    }

    if (!deps.captureOrder && !isPayPalEnabled) {
      return apiResponse.serverError("PayPal is not configured.");
    }

    let orderId: string | undefined;
    try {
      ({ orderId } = await req.json());
    } catch {
      return apiResponse.badRequest("Invalid request body.");
    }
    if (!orderId) {
      return apiResponse.badRequest("Missing orderId.");
    }

    try {
      const selected = await billing;
      const selectedSource = await sourceBilling;
      // Authorize against persistence before any provider capture side effect.
      const binding = await selectedSource.resolvePayPalSourceBinding(orderId);
      if (!binding || binding.userId !== user.id) {
        return apiResponse.forbidden("Order does not belong to the signed-in user.");
      }
      if (binding.organizationId) {
        const currentApp = await app;
        const live = await currentApp.commerce.runtime.deps.identity.isLiveMember(
          user.id,
          binding.organizationId,
        );
        if (!live)
          return apiResponse.forbidden("Original organization membership is no longer valid.");
      }
      const captureResult = await captureOrRecover(orderId, deps);

      // The capture object is the only carrier of settlement truth: the
      // order-level status enum has no PENDING at all (with eCheck the order is
      // COMPLETED while the capture is PENDING), so granting hinges on
      // capture.status alone. If the payload is incomplete, go back to the
      // original order once to fill in the gaps.
      const purchaseUnit = captureResult.purchase_units?.[0];
      let capture = purchaseUnit?.payments?.captures?.[0];
      let customId = purchaseUnit?.custom_id || capture?.custom_id;
      if (!capture || !customId) {
        const originalOrder = await (deps.getOrder ?? getPayPalOrder)(orderId).catch(() => null);
        const orderUnit = originalOrder?.purchase_units?.[0];
        capture ??= orderUnit?.payments?.captures?.[0];
        customId ||= orderUnit?.custom_id || capture?.custom_id;
      }

      const decoded = decodePayPalCustomId(customId);
      if (!decoded) {
        return apiResponse.serverError(
          "Failed to decode payment metadata. Please contact support.",
        );
      }

      // Ownership check: the buyer in custom_id must be the signed-in user.
      if (decoded.userId !== user.id) {
        logger.warn(
          { authenticatedUserId: user.id, customIdUserId: decoded.userId },
          "PayPal capture user mismatch",
        );
        return apiResponse.forbidden("User ID mismatch.");
      }

      // captureId is the idempotency key and the refund handle — never fall
      // back to orderId.
      if (!capture?.id) {
        return apiResponse.serverError(
          "Failed to determine payment capture ID. Please contact support.",
        );
      }
      const captureId = capture.id;

      const locale = await (deps.getLocale ?? getLocale)();
      const planName = getPlanName(decoded.planId, locale);

      if (capture.status === "COMPLETED") {
        // Synchronous source of truth: record the order and grant credits right
        // away (idempotent, so a racing webhook is harmless).
        await selected.fulfillPayPalCapture(
          {
            captureId,
            customId,
            sourceOrderId: orderId,
            amountValue: capture.amount?.value,
            currencyCode: capture.amount?.currency_code,
            payerId: captureResult.payer?.payer_id ?? null,
            metadata: {
              paypalOrderId: orderId,
              paypalCaptureId: captureId,
              paypalPayerId: captureResult.payer?.payer_id ?? null,
              customId,
            },
          },
          deps.adapter,
        );

        return apiResponse.success({
          orderId: captureId,
          planName,
          message: "Payment captured and order confirmed.",
        });
      }

      if (capture.status === "PENDING") {
        // Paper trail for money in flight: write a status='pending' 0-credit
        // order row (visible to the user and the admin console, traceable by the
        // reconcile cron). On settlement PAYMENT.CAPTURE.COMPLETED promotes it
        // in place and grants credits; if the webhook is lost, the success
        // page's order_id re-verification and the reconcile cron are two
        // self-healing channels; on a bounce the DENIED webhook marks it failed.
        // The Discord alert gives ops an immediate signal.
        await selected.recordPendingPayPalCapture(
          {
            captureId,
            customId,
            sourceOrderId: orderId,
            amountValue: capture.amount?.value,
            currencyCode: capture.amount?.currency_code,
            payerId: captureResult.payer?.payer_id ?? null,
            metadata: {
              paypalOrderId: orderId,
              paypalCaptureId: captureId,
              paypalPayerId: captureResult.payer?.payer_id ?? null,
              customId,
            },
          },
          deps.adapter,
        );

        const pendingCapture = capture;
        const schedulePendingAlert = deps.schedule ?? after;
        try {
          schedulePendingAlert(() => {
            void Promise.resolve(
              notifyPendingPayment({
                provider: "paypal",
                providerPaymentId: captureId,
                planId: decoded.planId,
                amountValue: pendingCapture.amount?.value ?? "unknown",
                currency: pendingCapture.amount?.currency_code ?? "USD",
                userId: decoded.userId,
              }),
            ).catch((error: unknown) => {
              logger.error(
                { err: error, providerPaymentId: captureId },
                "Failed to send pending PayPal alert",
              );
            });
          });
        } catch (error) {
          logger.error(
            { err: error, providerPaymentId: captureId },
            "Failed to register pending PayPal alert",
          );
        }

        return apiResponse.success({
          orderId: captureId,
          planName,
          pending: true,
          message: "Your payment is being processed. Please check back in a moment.",
        });
      }

      // DECLINED / FAILED / any other non-successful status
      return apiResponse.badRequest(`Payment capture failed with status: ${capture.status}`);
    } catch (error) {
      logger.error({ orderId, err: error }, "PayPal payment capture failed");
      return apiResponse.serverError("Failed to capture PayPal payment.");
    }
  };
}
