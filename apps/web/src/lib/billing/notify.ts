/**
 * [INPUT]: Depends on @/lib/mail for sendEmail, @/emails for the 4
 *          payment-related templates, @/config/pricing for getPlanById,
 *          @/lib/db and schema for the user table, @/lib/redis for setNx
 *          (alert dedup), @/lib/logger and its privacy helpers for sanitized
 *          diagnostics and email error details
 * [OUTPUT]: Exports notifyCreditGrantFailed, notifyInvoicePaymentFailed,
 *           notifyFraudWarningAdmin, notifyFraudRefundUser
 * [POS]: The notification layer of lib/billing — every email triggered by a
 *        webhook event is gathered here, all of them fire-and-safe (a send
 *        failure is only logged and never turns the webhook into a 5xx);
 *        notifyCreditGrantFailed dedups per provider object id via Redis
 *        SETNX (24h TTL, fail-open) — webhook retries and the reconcile cron
 *        re-entering on the same object send one alert email, not a barrage;
 *        raw Error objects and credential-bearing text never reach Pino,
 *        Sentry, or email props
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { getPlanById } from "@/config/pricing";
import { siteConfig } from "@/config/site";
import { CreditUpgradeFailedEmail } from "@/emails/credit-upgrade-failed";
import { FraudRefundUserEmail } from "@/emails/fraud-refund-user";
import { FraudWarningAdminEmail } from "@/emails/fraud-warning-admin";
import { InvoicePaymentFailedEmail } from "@/emails/invoice-payment-failed";
import { db } from "@/lib/db";
import { user as userSchema } from "@/lib/db/schema";
import { getLogger, type AppLogger } from "@/lib/logger";
import { sanitizeLogError, sanitizeLogText } from "@/lib/logger/privacy";
import { REDIS_KEYS_CONFIGS } from "@/lib/redis/redis-keys";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";

const logger = getLogger("billing.notify");

const adminSender = () => {
  const adminEmail = process.env.DEFAULT_ADMIN_EMAIL;
  if (!adminEmail) return null;
  return {
    to: adminEmail,
    from: {
      email: adminEmail,
      name: process.env.DEFAULT_ADMIN_NAME || siteConfig.name,
    },
  };
};

/** One alert per provider object within the TTL — see the dedup note below. */
const CREDIT_GRANT_FAILED_ALERT_TTL_S = 24 * 60 * 60;

async function loadAlertRedis(): Promise<typeof import("@/lib/redis").redis | null> {
  try {
    const { redis } = await import("@/lib/redis");
    return redis ?? null;
  } catch (error) {
    logger.error({ err: error }, "Billing alert dedup is unavailable");
    return null;
  }
}

async function deliverEmail(
  message: Parameters<typeof import("@/lib/mail").sendEmail>[0],
): Promise<void> {
  const { sendEmail } = await import("@/lib/mail");
  await sendEmail(message);
}

export interface BillingNotificationDeps {
  deliverEmail?: typeof deliverEmail;
  loadAlertRedis?: typeof loadAlertRedis;
  logger?: AppLogger;
}

function safeErrorForEmail(error: unknown): {
  errorMessage: string;
  errorStack?: string;
} {
  if (error instanceof Error) {
    const safe = sanitizeLogError(error);
    return { errorMessage: safe.message, errorStack: safe.stack };
  }
  if (typeof error === "string") {
    return { errorMessage: sanitizeLogText(error) };
  }
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return { errorMessage: sanitizeLogText(error.message) };
  }
  return { errorMessage: "Unknown billing error" };
}

/**
 * Credits failed to land after a successful payment — page the admin.
 *
 * Deduped per provider object id (orderId = invoice/session/sale id) via Redis
 * SETNX (24h TTL): webhook 5xx retries and the reconcile cron re-enter this
 * path over and over for the same unfulfillable object — one alert is enough,
 * the rest are only logged. Fail-open: send anyway when Redis is absent or
 * errors — a missed dedup costs one extra email, a missed alert costs money
 * already collected.
 */
export async function notifyCreditGrantFailed(
  params: {
    userId: string;
    orderId: string;
    planId: string;
    error: unknown;
  },
  deps: BillingNotificationDeps = {},
): Promise<void> {
  const alertLogger = deps.logger ?? logger;
  const loadRedis = deps.loadAlertRedis ?? loadAlertRedis;
  const sendEmail = deps.deliverEmail ?? deliverEmail;
  const sender = adminSender();
  if (!sender) return;

  const { userId, orderId, planId, error } = params;

  try {
    const redis = await loadRedis();
    if (redis) {
      const first = await redis.setNx(
        REDIS_KEYS_CONFIGS.billing.creditGrantFailedAlert(orderId),
        "1",
        CREDIT_GRANT_FAILED_ALERT_TTL_S,
      );
      if (!first) {
        alertLogger.error(
          { orderId, err: error },
          "Credit grant failed (alert already sent, deduped)",
        );
        return;
      }
    }
  } catch {
    // Redis down — fail open, send the alert anyway.
  }

  try {
    const safeError = safeErrorForEmail(error);
    await sendEmail({
      ...sender,
      subject: `🚨 CRITICAL: Credit grant failed for user ${userId}`,
      react: CreditUpgradeFailedEmail,
      reactProps: {
        userId,
        orderId,
        planId,
        ...safeError,
      },
    });
  } catch (emailError) {
    alertLogger.error({ err: emailError }, "Failed to send credit-grant-failed email");
  }
}

/** Renewal payment failed — tell the user how to fix their payment method. */
export async function notifyInvoicePaymentFailed(params: {
  invoice: Stripe.Invoice;
  subscriptionId: string;
  userId: string;
  planId: string | null;
}): Promise<void> {
  const { invoice, subscriptionId, userId, planId } = params;
  const adminEmail = process.env.DEFAULT_ADMIN_EMAIL;
  if (!adminEmail) return;

  try {
    const [userRow] = await db
      .select({ email: userSchema.email })
      .from(userSchema)
      .where(eq(userSchema.id, userId))
      .limit(1);
    if (!userRow?.email) return;

    await deliverEmail({
      to: userRow.email,
      from: {
        email: adminEmail,
        name: process.env.DEFAULT_ADMIN_NAME || siteConfig.name,
      },
      subject: `Action required: your ${siteConfig.name} subscription payment failed`,
      react: InvoicePaymentFailedEmail,
      reactProps: {
        invoiceId: invoice.id ?? "",
        subscriptionId,
        planName: planId && getPlanById(planId) ? planId : "your subscription",
        amountDue: invoice.amount_due / 100,
        currency: invoice.currency,
        nextPaymentAttemptDate: invoice.next_payment_attempt
          ? new Date(invoice.next_payment_attempt * 1000).toLocaleDateString()
          : undefined,
        updatePaymentMethodLink: `${siteConfig.url}/dashboard/billing`,
        supportLink: process.env.NEXT_PUBLIC_DISCORD_INVITE_URL || siteConfig.url,
      },
    });
  } catch (emailError) {
    logger.error({ err: emailError }, "Failed to send invoice-payment-failed email");
  }
}

/** Stripe Radar flagged a charge — report to the admin. */
export async function notifyFraudWarningAdmin(params: {
  warningId: string;
  charge: Stripe.Charge;
  actionsTaken: string[];
}): Promise<void> {
  const sender = adminSender();
  if (!sender) return;

  const { warningId, charge, actionsTaken } = params;
  try {
    await deliverEmail({
      ...sender,
      subject: `⚠️ Fraud warning: charge ${charge.id}`,
      react: FraudWarningAdminEmail,
      reactProps: {
        warningId,
        chargeId: charge.id,
        customerId: typeof charge.customer === "string" ? charge.customer : "",
        amount: charge.amount / 100,
        currency: charge.currency,
        fraudType: "Early Fraud Warning",
        chargeDescription: charge.description ?? undefined,
        actionsTaken,
        dashboardUrl: `https://dashboard.stripe.com/payments/${charge.payment_intent}`,
      },
    });
  } catch (emailError) {
    logger.error({ err: emailError }, "Failed to send fraud-warning admin email");
  }
}

/** Tell the user their flagged charge was refunded automatically. */
export async function notifyFraudRefundUser(params: { charge: Stripe.Charge }): Promise<void> {
  const { charge } = params;
  const adminEmail = process.env.DEFAULT_ADMIN_EMAIL;
  const userEmail = charge.billing_details?.email ?? charge.receipt_email;
  if (!adminEmail || !userEmail) return;

  try {
    await deliverEmail({
      to: userEmail,
      from: {
        email: adminEmail,
        name: process.env.DEFAULT_ADMIN_NAME || siteConfig.name,
      },
      subject: `Your payment to ${siteConfig.name} has been refunded`,
      react: FraudRefundUserEmail,
      reactProps: {
        userName: charge.billing_details?.name ?? undefined,
        chargeId: charge.id,
        amount: charge.amount / 100,
        currency: charge.currency,
        refundAmount: charge.amount / 100,
        chargeDescription: charge.description ?? undefined,
        refundDate: new Date().toLocaleDateString(),
        supportLink: process.env.NEXT_PUBLIC_DISCORD_INVITE_URL || siteConfig.url,
        dashboardLink: `${siteConfig.url}/dashboard/billing`,
      },
    });
  } catch (emailError) {
    logger.error({ err: emailError }, "Failed to send fraud-refund user email");
  }
}
