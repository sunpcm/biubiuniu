/**
 * [INPUT]: Depends on @/lib/stripe's getStripe, ./stripe's
 *          fulfillInvoicePaid/syncStripeSubscription/handleSubscriptionDeleted,
 *          ./creem's reconcileCreemSubscription, @/lib/creem/client's
 *          isCreemEnabled, ./paypal's fulfillPayPalCapture/
 *          handlePayPalCaptureDenied, @/lib/paypal's getPayPalCapture/
 *          isPayPalEnabled, @/config/pricing's PaymentProvider,
 *          @/lib/db and schema's subscriptions/orders tables, and the shared
 *          privacy-aware logger
 * [OUTPUT]: Exports reconcileOverdueRenewals, reconcilePendingPayPalCaptures
 * [POS]: The reconciliation layer of lib/billing — cron-driven self-healing for
 *        lost webhooks: renewal reconciliation (subscriptions whose local
 *        period has passed without advancing are dispatched by provider to each
 *        adapter's "pull the latest invoice/transaction → replay the same
 *        idempotent fulfillment path"; stripe, creem and paypal) + PayPal
 *        pending-capture reconciliation (one-time orders
 *        with status='pending' are re-read from the source for their latest
 *        settlement state: COMPLETED promotes and grants credits / a terminal
 *        state marks them failed / still PENDING backs off and keeps waiting)
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import type { PaymentProvider } from "@/config/pricing";
import { isCreemEnabled } from "@/lib/creem/client";
import { getAppCommerce, type AppCommerce } from "@/composition/commerce";
import { getLogger } from "@/lib/logger";
import {
  getPayPalCapture,
  getPayPalOrder,
  getPayPalSubscription,
  isPayPalEnabled,
  listPayPalSubscriptionTransactions,
} from "@/lib/paypal";
import { getStripe, isStripeEnabled } from "@/lib/stripe";
import type { StripeCheckoutDeps } from "./stripe";
import type { CreemAdapterDeps } from "./creem";
import type { PayPalAdapterDeps } from "./paypal";
import { createStripeBilling } from "./stripe";
import { createCreemBilling } from "./creem";
import { createPayPalBilling, payPalSaleFromSubscriptionTransaction } from "./paypal";

const logger = getLogger("billing.reconcile");

export interface ReconcileDeps {
  stripe?: StripeCheckoutDeps;
  creem?: CreemAdapterDeps;
  paypal?: PayPalAdapterDeps & { getOrder?: typeof getPayPalOrder };
}
import type Stripe from "stripe";

// ============================================================================
// Renewal reconciliation — the scheduled safety net under the renewal webhook.
//
// Credits are always granted against money (invoice.paid / subscription.paid),
// never blindly on a timer: granting at period end regardless of payment
// would hand out free months during the provider's multi-week retry window.
// What the cron guarantees instead is DELIVERY: if the webhook is lost, any
// subscription whose local period ended over an hour ago gets its latest
// invoice/transaction pulled from the provider and pushed through the exact
// same idempotent fulfillment path.
//
// Backoff needs no extra state: every outcome (fulfill, sync, deletion,
// explicit touch on failure) bumps `updatedAt`, and the due-query requires
// `updatedAt` to also be older than the grace window — so each subscription
// is examined at most once per hour.
//
// PayPal renewals use GET /v1/billing/subscriptions/{id}/transactions. Only a
// COMPLETED transaction is replayed through the sale fulfillment path. A
// refunded status without a local order is incomplete history, not a grant.
// ============================================================================

/** Webhooks get this long to arrive before the cron chases the provider. */
/** Statuses that can still renew; canceled/unpaid rows are left alone. */
type ReconcileOutcome = "ended" | "fulfilled" | "synced";

export function createReconcileBilling(app: AppCommerce) {
  const stripeBilling = createStripeBilling(app);
  const creemBilling = createCreemBilling(app);
  const paypalBilling = createPayPalBilling(app);

  async function reconcileStripeSubscription(
    providerSubscriptionId: string,
    deps: StripeCheckoutDeps = {},
  ): Promise<ReconcileOutcome> {
    const stripeSub = await (deps.getSubscription
      ? deps.getSubscription(providerSubscriptionId)
      : getStripe().subscriptions.retrieve(providerSubscriptionId, {
          expand: ["latest_invoice"],
        }));
    if (stripeSub.status === "canceled" || stripeSub.status === "incomplete_expired") {
      await stripeBilling.handleSubscriptionDeleted(stripeSub, deps);
      return "ended";
    }
    const latestInvoice = stripeSub.latest_invoice as Stripe.Invoice | null;
    if (latestInvoice?.status === "paid") {
      await stripeBilling.fulfillInvoicePaid(latestInvoice, deps);
      return "fulfilled";
    }
    await stripeBilling.syncStripeSubscription(stripeSub, deps);
    return "synced";
  }

  async function reconcilePayPalSubscription(
    row: { providerSubscriptionId: string; currentPeriodStart: Date | null },
    deps: ReconcileDeps,
  ): Promise<ReconcileOutcome> {
    const paypal = deps.paypal ?? {};
    const subscription = await (paypal.getSubscription ?? getPayPalSubscription)(
      row.providerSubscriptionId,
    );
    if (subscription.status === "CANCELLED" || subscription.status === "EXPIRED") {
      await paypalBilling.handlePayPalSubscriptionEnded(subscription, paypal);
      return "ended";
    }
    if (!row.currentPeriodStart) {
      throw new Error(
        `PayPal subscription ${row.providerSubscriptionId} has no verified current period start`,
      );
    }
    const end = app.commerce.runtime.deps.clock.now();
    if (end.getTime() <= row.currentPeriodStart.getTime()) {
      throw new Error(
        `PayPal subscription ${row.providerSubscriptionId} transaction window is empty`,
      );
    }
    const list =
      paypal.listSubscriptionTransactions ??
      ((subscriptionId: string, range: { startTime: string; endTime: string }) =>
        listPayPalSubscriptionTransactions({ subscriptionId, ...range }));
    const transactions = await list(row.providerSubscriptionId, {
      startTime: row.currentPeriodStart.toISOString(),
      endTime: end.toISOString(),
    });
    const ordered = [...transactions].sort((left, right) =>
      (left.time ?? "").localeCompare(right.time ?? ""),
    );
    let fulfilled = false;
    const unresolved: string[] = [];
    for (const transaction of ordered) {
      if (!transaction.id || !transaction.status) {
        throw new Error("PayPal subscription transaction is missing id or status");
      }
      const transactionId = transaction.id;
      if (transaction.status === "DECLINED" || transaction.status === "FAILED") continue;
      if (transaction.status === "PENDING") {
        unresolved.push(`${transaction.id} (pending is not a completed sale)`);
        continue;
      }
      if (
        transaction.status !== "COMPLETED" &&
        transaction.status !== "REFUNDED" &&
        transaction.status !== "PARTIALLY_REFUNDED"
      ) {
        throw new Error(
          `PayPal subscription transaction ${transaction.id} has unrecognized status ${transaction.status}`,
        );
      }
      const existing = await app.commerce.runtime.withUnit(undefined, (unit) =>
        unit.orders.findByProviderOrder("paypal", transactionId),
      );
      if (transaction.status === "COMPLETED") {
        if (!existing) {
          await paypalBilling.handlePayPalSaleCompleted(
            payPalSaleFromSubscriptionTransaction(row.providerSubscriptionId, transaction),
            paypal,
          );
          fulfilled = true;
        }
        continue;
      }
      if (
        transaction.status === "REFUNDED" &&
        existing?.status === "refunded" &&
        existing.amountRefunded >= existing.amountTotal
      ) {
        continue;
      }
      unresolved.push(
        existing
          ? `${transaction.id} (local order cannot prove this ${transaction.status} status; transaction list has no refund id or amount)`
          : `${transaction.id} (no local order)`,
      );
    }
    if (unresolved.length) {
      throw new Error(
        `PayPal subscription ${row.providerSubscriptionId} has unresolved transactions ${unresolved.join(", ")}; refusing to grant or sync from status alone`,
      );
    }
    if (fulfilled) return "fulfilled";
    await paypalBilling.syncPayPalSubscriptionById(row.providerSubscriptionId, undefined, paypal);
    return "synced";
  }

  async function reconcileOverdueRenewals(
    limit: number,
    deps: ReconcileDeps = {},
  ): Promise<{ overdue: number; fulfilled: number; ended: number; failed: number }> {
    const reconcilers: Partial<
      Record<
        PaymentProvider,
        (row: {
          providerSubscriptionId: string;
          currentPeriodStart: Date | null;
        }) => Promise<ReconcileOutcome>
      >
    > = {
      ...(deps.stripe || isStripeEnabled
        ? {
            stripe: (row) => reconcileStripeSubscription(row.providerSubscriptionId, deps.stripe),
          }
        : {}),
      ...(deps.creem || isCreemEnabled
        ? {
            creem: (row) =>
              creemBilling.reconcileCreemSubscription(row.providerSubscriptionId, deps.creem),
          }
        : {}),
      ...(deps.paypal || isPayPalEnabled
        ? { paypal: (row) => reconcilePayPalSubscription(row, deps) }
        : {}),
    };
    return app.commerce.reconcileOverdueRenewals(limit, reconcilers);
  }

  async function reconcilePendingPayPalCaptures(
    limit: number,
    deps: ReconcileDeps = {},
  ): Promise<{ pending: number; fulfilled: number; failed: number; errors: number }> {
    if (!deps.paypal && !isPayPalEnabled) {
      return { pending: 0, fulfilled: 0, failed: 0, errors: 0 };
    }
    const rows = await app.commerce.listPendingPayPalCaptures(limit);
    const touch = (id: string) =>
      app.commerce.runtime.withUnit(undefined, (unit) =>
        unit.orders.touch(id, app.commerce.runtime.deps.clock.now()),
      );
    let fulfilled = 0;
    let failed = 0;
    let errors = 0;
    for (const row of rows) {
      try {
        const meta = row.metadata as Record<string, unknown> | null;
        let capture;
        if (row.providerPaymentId) {
          capture = await (deps.paypal?.getCapture ?? getPayPalCapture)(row.providerPaymentId);
        } else if (meta?.paypalSourceVersion === 1) {
          const order = await (deps.paypal?.getOrder ?? getPayPalOrder)(row.providerOrderId);
          if (order.id !== row.providerOrderId) {
            throw new Error("PayPal lookup order ID conflict");
          }
          const unit = order.purchase_units?.[0];
          capture = unit?.payments?.captures?.[0];
          if (capture && !capture.custom_id && unit?.custom_id) {
            capture = { ...capture, custom_id: unit.custom_id };
          }
        } else {
          capture = await (deps.paypal?.getCapture ?? getPayPalCapture)(row.providerOrderId);
        }
        if (!capture) {
          await touch(row.id);
          continue;
        }
        if (row.providerPaymentId && capture.id !== row.providerPaymentId) {
          throw new Error("PayPal lookup capture ID conflict");
        }
        const customId =
          capture.custom_id ??
          ((row.metadata as Record<string, unknown> | null)?.customId as string | undefined);
        if (capture.status === "COMPLETED") {
          await paypalBilling.fulfillPayPalCapture(
            {
              captureId: capture.id,
              customId,
              sourceOrderId:
                meta?.paypalSourceVersion === 1
                  ? row.providerOrderId
                  : typeof meta?.paypalOrderId === "string"
                    ? meta.paypalOrderId
                    : null,
              amountValue: capture.amount?.value,
              currencyCode: capture.amount?.currency_code,
              metadata: { paypalCaptureId: capture.id, customId },
            },
            deps.paypal,
          );
          fulfilled += 1;
        } else if (capture.status === "PENDING") {
          await touch(row.id);
        } else {
          await paypalBilling.handlePayPalCaptureDenied({
            ...capture,
            custom_id: customId,
          });
          failed += 1;
        }
      } catch (error) {
        errors += 1;
        logger.error(
          { providerOrderId: row.providerOrderId, err: error },
          "Pending PayPal capture reconciliation failed",
        );
        await touch(row.id).catch(() => {});
      }
    }
    return { pending: rows.length, fulfilled, failed, errors };
  }

  return { reconcileOverdueRenewals, reconcilePendingPayPalCaptures };
}

export type ReconcileBilling = ReturnType<typeof createReconcileBilling>;

async function defaultBilling(): Promise<ReconcileBilling> {
  return createReconcileBilling(await getAppCommerce());
}

export function reconcileOverdueRenewals(
  limit: number,
  deps: ReconcileDeps = {},
): Promise<{ overdue: number; fulfilled: number; ended: number; failed: number }> {
  return defaultBilling().then((billing) => billing.reconcileOverdueRenewals(limit, deps));
}

export function reconcilePendingPayPalCaptures(
  limit: number,
  deps: ReconcileDeps = {},
): Promise<{ pending: number; fulfilled: number; failed: number; errors: number }> {
  return defaultBilling().then((billing) => billing.reconcilePendingPayPalCaptures(limit, deps));
}
