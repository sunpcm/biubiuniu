/**
 * [INPUT]: Depends on @/lib/paypal's decodePayPalCustomId/getPayPalSubscription/
 *          getPayPalCapture and the webhook payload types, @/config/pricing's
 *          plan resolution (getPlanById/findPlanByProviderPriceId/getPlanCredits/
 *          isSubscriptionPlan), ./fulfillment's provider-agnostic core, ./cancel's
 *          provider-side cancel funnel, ./duplicate's duplicate-subscription
 *          settlement funnel (injected refundPayPalCapture closure: an already
 *          fully refunded sale is normalized to success, a v1 id the endpoint
 *          refuses becomes a PermanentFulfillmentError), @/lib/db and the
 *          schema's orders/user tables, @/lib/logger for sanitized diagnostics
 * [OUTPUT]: Exports mapPayPalSubscriptionStatus, fulfillPayPalCapture,
 *           fulfillPayPalCaptureById (three states: paid/failed/pending),
 *           recordPendingPayPalCapture (pending-order trace of an in-flight
 *           capture),
 *           syncPayPalSubscriptionById,
 *           handlePayPalCaptureCompleted, handlePayPalCaptureDenied,
 *           handlePayPalCaptureRefunded, handlePayPalSaleCompleted,
 *           handlePayPalSaleRefunded, handlePayPalSubscriptionActivated,
 *           handlePayPalSubscriptionSuspended, handlePayPalSubscriptionEnded,
 *           handlePayPalSubscriptionPaymentFailed
 * [POS]: The PayPal adapter of lib/billing — the only fulfillment file where
 *        PayPal payload types appear: it translates the PayPal objects obtained
 *        from webhook/capture-order into ./types inputs and calls the core;
 *        custom_id (userId|planId|…|organizationId) carries the subject and the
 *        plan, and the sole writer of user.paypalPayerId also lives here; amounts
 *        always go "PayPal decimal string → integer cents"; PayPal-side
 *        cancellation for full refunds and superseded subscriptions goes through
 *        ./cancel, and PayPal-specific policies such as the PAYMENT.SALE
 *        initial-vs-renewal decision all live here; operator notifications use
 *        the owning AppCommerce instance
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { isSubscriptionPlan, type PricingPlan, type SubscriptionPlan } from "@/config/pricing";
import {
  decodePayPalCustomId,
  getPayPalCapture,
  getPayPalSubscription,
  refundPayPalCapture,
} from "@/lib/paypal";
import { getLogger } from "@/lib/logger";
import {
  defaultSourceIdentityCatalog,
  resolvePlanBySource,
  type SourceIdentityCatalog,
} from "@/lib/pricing/source-identity";
import { paypalAmountToMinor } from "@/lib/paypal/money";
import type { PayPalSubscriptionTransaction } from "@/lib/paypal/transactions";
import type {
  PayPalCapture,
  PayPalLink,
  PayPalPaymentCaptureRefunded,
  PayPalPaymentSaleRefunded,
  PayPalSaleResource,
  PayPalSubscription,
} from "@/lib/paypal/types";
import { cancelProviderSubscription } from "./cancel";
import { settleDuplicateSubscription } from "./duplicate";
import {
  createPayPalProvider,
  type PayPalSubscriptionResource,
  type PayPalVerifyTransport,
} from "@sunpcm/niu-commerce/providers/paypal";
import { getAppCommerce, type AppCommerce } from "@/composition/commerce";
import { PermanentFulfillmentError, createFulfillmentBilling } from "./fulfillment";
import { createSourceBindingBilling } from "./source-binding";
import { createPayPalSourceBilling } from "./paypal-source";
import type { BillingSubject, CanonicalSubscriptionStatus, SubscriptionSyncInput } from "./types";

const logger = getLogger("billing.paypal");

// ============================================================================
// Status mapping — normalizing PayPal subscription status. APPROVED/
// APPROVAL_PENDING mean "approved but the first payment has not landed": until
// the money arrives it is always incomplete. SUSPENDED matches the dunning
// period of a failed charge, mapped to past_due (ENTITLED benefits are kept
// while PayPal retries).
// ============================================================================

export function mapPayPalSubscriptionStatus(status: string): CanonicalSubscriptionStatus {
  switch (status) {
    case "ACTIVE":
      return "active";
    case "APPROVED":
    case "APPROVAL_PENDING":
      return "incomplete";
    case "SUSPENDED":
      return "past_due";
    case "CANCELLED":
      return "canceled";
    case "EXPIRED":
      return "expired";
    default:
      return "incomplete";
  }
}

// ----------------------------------------------------------------------------
// Helpers — amount and time conversion, payer id persistence, subject resolution
// ----------------------------------------------------------------------------

/** PayPal decimal amount string ("9.99") → integer cents. */
function toCents(amount: string | null | undefined): number {
  return paypalAmountToMinor(amount);
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The "up" link of a refund/reversal resource → the original capture/sale id. */
function idFromUpLink(links: PayPalLink[] | undefined): string | null {
  const up = links?.find((link) => link.rel === "up");
  return up?.href?.split("/").pop() ?? null;
}

/**
 * Plan resolution for PayPal events: the PayPal Billing Plan id is
 * authoritative when present (custom_id.planId is a cross-check that must
 * agree); custom_id alone is only honored for legacy events that carry no
 * Billing Plan id. Returns null when the source cannot be attributed.
 */
export function resolvePayPalPlan(
  planId: string | null | undefined,
  providerPlanId: string | null | undefined = null,
  catalog: SourceIdentityCatalog = defaultSourceIdentityCatalog,
): PricingPlan | null {
  return resolvePlanBySource(
    {
      provider: "paypal",
      metadataPlanId: planId ?? null,
      externalId: providerPlanId ?? null,
    },
    catalog,
  );
}

// ----------------------------------------------------------------------------
// One-time credit pack purchase (capture)
// ----------------------------------------------------------------------------

/**
 * One-time credit pack fulfillment: the single entry point shared by the
 * capture-order route (the synchronous source of truth) and the webhook
 * PAYMENT.CAPTURE.COMPLETED (the idempotent backstop). The idempotency key is
 * (paypal, capture id) — when the two paths collide, the later one gets
 * created:false. providerPaymentId is the capture id as well: PayPal refunds
 * take the capture as their handle.
 */
export interface PayPalAdapterDeps {
  catalog?: SourceIdentityCatalog;
  getSubscription?: typeof getPayPalSubscription;
  getCapture?: typeof getPayPalCapture;
  webhookId?: string;
  transport?: PayPalVerifyTransport;
  listSubscriptionTransactions?: (
    subscriptionId: string,
    range: { startTime: string; endTime: string },
  ) => Promise<PayPalSubscriptionTransaction[]>;
}

interface CaptureInput {
  captureId: string;
  customId: string | null | undefined;
  sourceOrderId?: string | null;
  amountValue: string | null | undefined;
  currencyCode: string | null | undefined;
  payerId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Cumulative refund fields on the v2 refund resource (not modeled in lib/paypal/types). */
type PayPalCaptureRefundResource = PayPalPaymentCaptureRefunded["resource"] & {
  seller_payable_breakdown?: {
    total_refunded_amount?: { currency_code: string; value: string };
  };
};

/** Cumulative refund field on the v1 sale refund resource (not modeled in lib/paypal/types). */
type PayPalSaleRefundResource = PayPalPaymentSaleRefunded["resource"] & {
  total_refunded_amount?: { currency: string; value: string };
};

export function createPayPalBilling(app: AppCommerce) {
  const fulfillment = createFulfillmentBilling(app);
  const sourceBinding = createSourceBindingBilling(app);
  const paypalSource = createPayPalSourceBilling(app);
  const sourceCatalog = (deps: PayPalAdapterDeps): SourceIdentityCatalog =>
    deps.catalog ?? (app.commerce.runtime.catalog as SourceIdentityCatalog);

  async function savePayPalPayerId(userId: string, payerId: string): Promise<void> {
    try {
      const written = await app.commerce.runtime.withUnit(undefined, (unit) =>
        unit.identity.writeProviderCustomerIfAbsent(
          userId,
          "paypal",
          payerId,
          app.commerce.runtime.deps.clock.now(),
        ),
      );
      if (written === "conflict") {
        logger.warn({ userId }, "User already has a different PayPal payer id");
      }
    } catch (error) {
      logger.error({ userId, err: error }, "Failed to save PayPal payer id");
    }
  }

  async function resolvePayPalUserId(params: {
    candidateUserId?: string | null;
    payerId?: string | null;
  }): Promise<string | null> {
    const fromCustomId = await fulfillment.resolveValidUserId(params.candidateUserId);
    if (fromCustomId) return fromCustomId;
    if (!params.payerId) return null;
    return app.commerce.runtime.withUnit(undefined, (unit) =>
      unit.identity.findUserIdByProviderCustomer("paypal", params.payerId!),
    );
  }

  async function resolvePayPalSubject(params: {
    candidateUserId?: string | null;
    organizationId?: string | null;
    payerId?: string | null;
  }): Promise<BillingSubject> {
    const [userId, organizationId] = await Promise.all([
      resolvePayPalUserId(params),
      fulfillment.resolveValidOrganizationId(params.organizationId),
    ]);
    return { userId, organizationId };
  }

  async function paypalProvider(
    deps: PayPalAdapterDeps & { webhookId: string; transport: PayPalVerifyTransport },
  ) {
    return createPayPalProvider({
      webhookId: deps.webhookId,
      commerce: app.commerce,
      catalog: deps.catalog,
      transport: deps.transport,
      loadSubscription: async (subscriptionId) => {
        const load = deps.getSubscription ?? getPayPalSubscription;
        const sub = await load(subscriptionId);
        const resource: PayPalSubscriptionResource = {
          id: sub.id,
          status: sub.status,
          plan_id: sub.plan_id,
          custom_id: sub.custom_id ?? null,
          update_time: sub.update_time,
          subscriber: sub.subscriber ? { payer_id: sub.subscriber.payer_id } : null,
          billing_info: sub.billing_info
            ? {
                last_payment: sub.billing_info.last_payment
                  ? { time: sub.billing_info.last_payment.time }
                  : null,
                next_billing_time: sub.billing_info.next_billing_time ?? null,
              }
            : null,
        };
        return resource;
      },
      refundSale: async (saleId) => {
        await refundPayPalCapture(saleId);
      },
    });
  }

  async function boundCapture(params: CaptureInput, deps: PayPalAdapterDeps) {
    const decoded = decodePayPalCustomId(params.customId);
    const catalog = sourceCatalog(deps);
    const bound = await paypalSource.resolvePayPalSourceBinding(
      params.sourceOrderId,
      params.captureId,
    );
    if (!bound) throw new Error(`No verified PayPal order binding for capture ${params.captureId}`);
    if (params.customId && !decoded) throw new Error("Malformed PayPal custom_id");
    if (decoded) {
      sourceBinding.assertBoundMetadata(bound, decoded);
      if (decoded.organizationId !== bound.organizationId) {
        throw new Error("PayPal organization binding conflict");
      }
    }
    const plan = catalog.getPlanById(bound.planId);
    if (!plan || plan.provider !== "paypal" || plan.kind !== "credit_pack") {
      throw new Error("PayPal binding does not identify a credit pack");
    }
    if (
      toCents(params.amountValue) !== bound.amountTotal ||
      params.currencyCode?.toLowerCase() !== bound.currency.toLowerCase()
    ) {
      throw new Error("PayPal capture money conflicts with checkout binding");
    }
    return { bound, plan };
  }

  async function fulfillPayPalCapture(
    params: CaptureInput,
    deps: PayPalAdapterDeps = {},
  ): Promise<{ created: boolean; planId: string | null }> {
    const provider = await paypalProvider({
      ...deps,
      webhookId: deps.webhookId ?? "direct-paypal-call",
      transport: deps.transport ?? {
        async verifySignature() {
          return { status: 200, verificationStatus: "SUCCESS" };
        },
      },
    });
    const result = await provider.fulfillCapture({
      captureId: params.captureId,
      customId: params.customId,
      sourceOrderId: params.sourceOrderId,
      amountValue: params.amountValue,
      currencyCode: params.currencyCode,
      metadata: params.metadata ?? undefined,
      payerId: params.payerId,
    });
    return { created: result.created, planId: result.planId };
  }

  async function recordPendingPayPalCapture(
    params: CaptureInput,
    deps: PayPalAdapterDeps = {},
  ): Promise<{ created: boolean }> {
    const decoded = decodePayPalCustomId(params.customId);
    const echo = decoded ? sourceCatalog(deps).getPlanById(decoded.planId) : null;
    if (echo?.provider === "paypal" && isSubscriptionPlan(echo)) return { created: false };
    const { bound } = await boundCapture(params, deps);
    await paypalSource.attachPendingPayPalCapture(bound.id, params.captureId, {
      ...params.metadata,
      customId: params.customId ?? null,
    });
    return { created: false };
  }

  async function handlePayPalCaptureCompleted(
    capture: PayPalCapture & { custom_id?: string },
    deps: PayPalAdapterDeps = {},
  ): Promise<void> {
    if (capture.status !== "COMPLETED") return;
    const sourceOrderId =
      (
        capture as PayPalCapture & {
          supplementary_data?: { related_ids?: { order_id?: string } };
        }
      ).supplementary_data?.related_ids?.order_id ?? null;
    await fulfillPayPalCapture(
      {
        captureId: capture.id,
        customId: capture.custom_id,
        sourceOrderId,
        amountValue: capture.amount?.value,
        currencyCode: capture.amount?.currency_code,
        metadata: { paypalCaptureId: capture.id, customId: capture.custom_id },
      },
      deps,
    );
  }

  async function fulfillPayPalCaptureById(
    captureId: string,
    expectedUserId: string,
    deps: PayPalAdapterDeps = {},
  ): Promise<{
    paid: boolean;
    failed: boolean;
    planId: string | null;
    userId: string | null;
  }> {
    const capture = await (deps.getCapture ?? getPayPalCapture)(captureId);
    const decoded = decodePayPalCustomId(capture.custom_id);
    const paid = capture.status === "COMPLETED";
    const failed = !paid && capture.status !== "PENDING";
    const planId = decoded?.planId ?? null;
    const userId = decoded?.userId ?? null;
    if (!paid || userId !== expectedUserId) return { paid, failed, planId, userId };
    await fulfillPayPalCapture(
      {
        captureId: capture.id,
        customId: capture.custom_id,
        amountValue: capture.amount?.value,
        currencyCode: capture.amount?.currency_code,
        metadata: { paypalCaptureId: capture.id, customId: capture.custom_id },
      },
      deps,
    );
    return { paid, failed, planId, userId };
  }

  async function handlePayPalCaptureDenied(
    capture: PayPalCapture & { custom_id?: string },
  ): Promise<void> {
    await app.commerce.runtime.withUnit(undefined, (unit) =>
      unit.orders.markPendingFailed("paypal", capture.id, app.commerce.runtime.deps.clock.now()),
    );
    const decoded = decodePayPalCustomId(capture.custom_id);
    await app.commerce.runtime.deps.notifier?.onPaymentDenied?.({
      provider: "paypal",
      providerPaymentId: capture.id,
      planId: decoded?.planId ?? "unknown",
      userId: decoded?.userId ?? "unknown",
    });
  }

  async function buildPayPalSyncInput(
    sub: PayPalSubscription,
    statusOverride?: CanonicalSubscriptionStatus,
    deps: PayPalAdapterDeps = {},
  ): Promise<{ input: SubscriptionSyncInput; plan: SubscriptionPlan } | null> {
    const decoded = decodePayPalCustomId(sub.custom_id);
    const catalog = sourceCatalog(deps);
    const source = await sourceBinding.resolveSubscriptionSource({
      provider: "paypal",
      subscriptionId: sub.id,
      externalId: sub.plan_id,
      metadata: decoded ?? {},
      catalog,
    });
    const plan = source ? catalog.getPlanById(source.plan.id) : undefined;
    if (!plan || !isSubscriptionPlan(plan)) {
      logger.error(
        { providerPlanId: sub.plan_id, providerSubscriptionId: sub.id },
        "No PayPal subscription plan matches the provider plan",
      );
      return null;
    }
    const subject =
      source?.subject ??
      (await resolvePayPalSubject({
        candidateUserId: decoded?.userId,
        organizationId: decoded?.organizationId,
        payerId: sub.subscriber?.payer_id,
      }));
    return {
      plan,
      input: {
        provider: "paypal",
        providerSubscriptionId: sub.id,
        subject,
        planId: plan.id,
        providerCustomerId: sub.subscriber?.payer_id ?? null,
        providerPriceId: source?.providerPriceId,
        status: statusOverride ?? mapPayPalSubscriptionStatus(sub.status),
        interval: plan.interval,
        currentPeriodStart: toDate(sub.billing_info?.last_payment?.time),
        currentPeriodEnd: toDate(sub.billing_info?.next_billing_time),
        cancelAtPeriodEnd: false,
        canceledAt: sub.status === "CANCELLED" ? (toDate(sub.update_time) ?? new Date()) : null,
        endedAt: sub.status === "EXPIRED" ? (toDate(sub.update_time) ?? new Date()) : null,
        monthlyCredits: plan.monthlyCredits,
        metadata: {
          customId: sub.custom_id ?? null,
          paypalPlanId: sub.plan_id,
          paypalPayerId: sub.subscriber?.payer_id ?? null,
        },
      },
    };
  }

  async function syncPayPalSubscriptionById(
    subscriptionId: string,
    statusOverride?: CanonicalSubscriptionStatus,
    deps: PayPalAdapterDeps = {},
  ): Promise<SubscriptionSyncInput | null> {
    const sub = await (deps.getSubscription ?? getPayPalSubscription)(subscriptionId);
    const built = await buildPayPalSyncInput(sub, statusOverride, deps);
    if (!built) return null;
    await fulfillment.syncSubscription(built.input);
    if (sub.subscriber?.payer_id && built.input.subject.userId) {
      await savePayPalPayerId(built.input.subject.userId, sub.subscriber.payer_id);
    }
    return built.input;
  }

  async function handlePayPalSubscriptionActivated(
    resource: PayPalSubscription,
    deps: PayPalAdapterDeps = {},
  ): Promise<void> {
    await syncPayPalSubscriptionById(resource.id, undefined, deps);
  }

  async function handlePayPalSubscriptionSuspended(
    resource: PayPalSubscription,
    deps: PayPalAdapterDeps = {},
  ): Promise<void> {
    await syncPayPalSubscriptionById(resource.id, undefined, deps);
  }

  async function handlePayPalSubscriptionPaymentFailed(
    resource: PayPalSubscription,
    deps: PayPalAdapterDeps = {},
  ): Promise<void> {
    const input = await syncPayPalSubscriptionById(resource.id, "past_due", deps);
    logger.warn(
      { providerSubscriptionId: resource.id, userId: input?.subject.userId },
      "PayPal subscription payment failed",
    );
  }

  async function handlePayPalSubscriptionEnded(
    resource: PayPalSubscription,
    deps: PayPalAdapterDeps = {},
  ): Promise<void> {
    const status = mapPayPalSubscriptionStatus(resource.status);
    try {
      await syncPayPalSubscriptionById(resource.id, undefined, deps);
    } catch (error) {
      logger.error(
        { providerSubscriptionId: resource.id, err: error },
        "Failed to refresh PayPal subscription before ending it",
      );
    }
    const endedAt = toDate(resource.update_time) ?? new Date();
    await fulfillment.handleSubscriptionEnded("paypal", resource.id, {
      status: status === "expired" ? "expired" : "canceled",
      canceledAt: status === "canceled" ? endedAt : undefined,
      endedAt: status === "expired" ? endedAt : undefined,
    });
  }

  async function handlePayPalSaleCompleted(
    sale: PayPalSaleResource,
    deps: PayPalAdapterDeps = {},
  ): Promise<void> {
    const subscriptionId = sale.billing_agreement_id;
    if (!subscriptionId) {
      logger.error(
        { providerOrderId: sale.id },
        "PayPal sale has no billing agreement id; skipping fulfillment",
      );
      return;
    }
    const fresh = await (deps.getSubscription ?? getPayPalSubscription)(subscriptionId);
    const subForBuild: PayPalSubscription = fresh.custom_id
      ? fresh
      : { ...fresh, custom_id: sale.custom_id ?? sale.custom };
    const built = await buildPayPalSyncInput(subForBuild, undefined, deps);
    if (!built) {
      throw new Error(
        `Cannot fulfill PayPal sale ${sale.id}: subscription ${subscriptionId} did not resolve to a plan`,
      );
    }
    if (fresh.subscriber?.payer_id && built.input.subject.userId) {
      await savePayPalPayerId(built.input.subject.userId, fresh.subscriber.payer_id);
    }
    const prior = await app.commerce.runtime.withUnit(undefined, (unit) =>
      unit.subscriptions.countOtherSubscriptionOrders("paypal", subscriptionId, sale.id),
    );
    const { duplicate } = await fulfillment.fulfillSubscriptionPayment({
      subscription: built.input,
      orderType: prior > 0 ? "subscription_renewal" : "subscription_initial",
      providerOrderId: sale.id,
      providerPaymentId: sale.id,
      amountTotal: toCents(sale.amount?.total),
      currency: (sale.amount?.currency ?? "USD").toLowerCase(),
      periodStart: toDate(sale.create_time) ?? built.input.currentPeriodStart,
      metadata: {
        paypalSaleId: sale.id,
        paypalSubscriptionId: subscriptionId,
        paypalParentPayment: sale.parent_payment ?? null,
      },
    });
    if (duplicate) {
      await settleDuplicateSubscription({
        provider: "paypal",
        providerSubscriptionId: subscriptionId,
        providerOrderId: sale.id,
        winner: duplicate,
        amountTotal: toCents(sale.amount?.total),
        currency: (sale.amount?.currency ?? "USD").toLowerCase(),
        userId: built.input.subject.userId,
        refund: async () => {
          try {
            await refundPayPalCapture(sale.id);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/CAPTURE_FULLY_REFUNDED/i.test(message)) return;
            if (/RESOURCE_NOT_FOUND|INVALID_RESOURCE_ID|\b404\b/i.test(message)) {
              throw new PermanentFulfillmentError(
                `PayPal refuses to refund sale ${sale.id} (${message}) — refund it manually in the PayPal dashboard`,
              );
            }
            throw error;
          }
        },
      });
    }
  }

  async function handlePayPalCaptureRefunded(resource: PayPalCaptureRefundResource): Promise<void> {
    const captureId = idFromUpLink(resource.links) ?? resource.id;
    if (!captureId) {
      throw new Error(
        `PayPal refund/reversal carries neither an "up" link nor a resource id — cannot locate the local order`,
      );
    }
    const officialCumulative = resource.seller_payable_breakdown?.total_refunded_amount?.value;
    const eventAmount = resource.amount?.value;
    if (!resource.id) throw new Error("PayPal capture refund has no stable refund id");
    if (!officialCumulative && !eventAmount) {
      throw new Error(
        `PayPal refund ${resource.id} has neither an official cumulative total nor an event amount`,
      );
    }
    const { orderFound, fullRefundOfSubscription, providerSubscriptionId } =
      await fulfillment.applyRefund({
        provider: "paypal",
        providerPaymentId: captureId,
        amountRefunded: toCents(officialCumulative ?? eventAmount),
        cumulative: officialCumulative != null,
        refundId: resource.id,
      });
    if (!orderFound) {
      throw new Error(
        `PayPal refund ${resource.id}: no local order for capture ${captureId} — retrying until the completed-capture order lands`,
      );
    }
    if (fullRefundOfSubscription && providerSubscriptionId) {
      await cancelProviderSubscription("paypal", providerSubscriptionId, "Fully refunded");
    }
  }

  async function handlePayPalSaleRefunded(resource: PayPalSaleRefundResource): Promise<void> {
    const saleId = resource.sale_id ?? idFromUpLink(resource.links);
    if (!saleId) {
      throw new Error(
        `PayPal refund ${resource.id} carries neither sale_id nor an "up" link — cannot locate the local order`,
      );
    }
    const officialCumulative = resource.total_refunded_amount?.value;
    const eventAmount = resource.amount?.total;
    if (!resource.id) {
      throw new Error(`PayPal sale refund for ${saleId} has no stable refund id`);
    }
    if (!officialCumulative && !eventAmount) {
      throw new Error(
        `PayPal refund ${resource.id} has neither an official cumulative total nor an event amount`,
      );
    }
    const { orderFound, fullRefundOfSubscription, providerSubscriptionId } =
      await fulfillment.applyRefund({
        provider: "paypal",
        providerPaymentId: saleId,
        amountRefunded: toCents(officialCumulative ?? eventAmount),
        cumulative: officialCumulative != null,
        refundId: resource.id,
      });
    if (!orderFound) {
      throw new Error(
        `PayPal refund ${resource.id}: no local order for sale ${saleId} — retrying until the sale order lands`,
      );
    }
    if (fullRefundOfSubscription && providerSubscriptionId) {
      await cancelProviderSubscription("paypal", providerSubscriptionId, "Fully refunded");
    }
  }

  return {
    resolvePayPalSubject,
    paypalProvider,
    fulfillPayPalCapture,
    recordPendingPayPalCapture,
    handlePayPalCaptureCompleted,
    fulfillPayPalCaptureById,
    handlePayPalCaptureDenied,
    syncPayPalSubscriptionById,
    handlePayPalSubscriptionActivated,
    handlePayPalSubscriptionSuspended,
    handlePayPalSubscriptionPaymentFailed,
    handlePayPalSubscriptionEnded,
    handlePayPalSaleCompleted,
    handlePayPalCaptureRefunded,
    handlePayPalSaleRefunded,
  };
}

export type PayPalBilling = ReturnType<typeof createPayPalBilling>;

export function selectedPayPalApp(): Promise<AppCommerce> {
  return getAppCommerce();
}

async function defaultBilling(): Promise<PayPalBilling> {
  return createPayPalBilling(await getAppCommerce());
}

export function resolvePayPalSubject(params: Parameters<PayPalBilling["resolvePayPalSubject"]>[0]) {
  return defaultBilling().then((billing) => billing.resolvePayPalSubject(params));
}

export function paypalProvider(deps: Parameters<PayPalBilling["paypalProvider"]>[0]) {
  return defaultBilling().then((billing) => billing.paypalProvider(deps));
}

export function fulfillPayPalCapture(params: CaptureInput, deps: PayPalAdapterDeps = {}) {
  return defaultBilling().then((billing) => billing.fulfillPayPalCapture(params, deps));
}

export function recordPendingPayPalCapture(params: CaptureInput, deps: PayPalAdapterDeps = {}) {
  return defaultBilling().then((billing) => billing.recordPendingPayPalCapture(params, deps));
}

export function handlePayPalCaptureCompleted(
  capture: PayPalCapture & { custom_id?: string },
  deps: PayPalAdapterDeps = {},
) {
  return defaultBilling().then((billing) => billing.handlePayPalCaptureCompleted(capture, deps));
}

export function fulfillPayPalCaptureById(
  captureId: string,
  expectedUserId: string,
  deps: PayPalAdapterDeps = {},
) {
  return defaultBilling().then((billing) =>
    billing.fulfillPayPalCaptureById(captureId, expectedUserId, deps),
  );
}

export function handlePayPalCaptureDenied(capture: PayPalCapture & { custom_id?: string }) {
  return defaultBilling().then((billing) => billing.handlePayPalCaptureDenied(capture));
}

export function syncPayPalSubscriptionById(
  subscriptionId: string,
  statusOverride?: CanonicalSubscriptionStatus,
  deps: PayPalAdapterDeps = {},
) {
  return defaultBilling().then((billing) =>
    billing.syncPayPalSubscriptionById(subscriptionId, statusOverride, deps),
  );
}

export function handlePayPalSubscriptionActivated(
  resource: PayPalSubscription,
  deps: PayPalAdapterDeps = {},
) {
  return defaultBilling().then((billing) =>
    billing.handlePayPalSubscriptionActivated(resource, deps),
  );
}

export function handlePayPalSubscriptionSuspended(
  resource: PayPalSubscription,
  deps: PayPalAdapterDeps = {},
) {
  return defaultBilling().then((billing) =>
    billing.handlePayPalSubscriptionSuspended(resource, deps),
  );
}

export function handlePayPalSubscriptionPaymentFailed(
  resource: PayPalSubscription,
  deps: PayPalAdapterDeps = {},
) {
  return defaultBilling().then((billing) =>
    billing.handlePayPalSubscriptionPaymentFailed(resource, deps),
  );
}

export function handlePayPalSubscriptionEnded(
  resource: PayPalSubscription,
  deps: PayPalAdapterDeps = {},
) {
  return defaultBilling().then((billing) => billing.handlePayPalSubscriptionEnded(resource, deps));
}

export function handlePayPalSaleCompleted(sale: PayPalSaleResource, deps: PayPalAdapterDeps = {}) {
  return defaultBilling().then((billing) => billing.handlePayPalSaleCompleted(sale, deps));
}

export function handlePayPalCaptureRefunded(resource: PayPalCaptureRefundResource) {
  return defaultBilling().then((billing) => billing.handlePayPalCaptureRefunded(resource));
}

export function handlePayPalSaleRefunded(resource: PayPalSaleRefundResource) {
  return defaultBilling().then((billing) => billing.handlePayPalSaleRefunded(resource));
}

/** Official subscription-transaction row → the sale shape the renewal webhook already fulfills. */
export function payPalSaleFromSubscriptionTransaction(
  subscriptionId: string,
  transaction: PayPalSubscriptionTransaction,
): PayPalSaleResource {
  const gross = transaction.amount_with_breakdown?.gross_amount;
  if (!transaction.id || !transaction.time || !gross?.value || !gross.currency_code) {
    throw new Error(
      `PayPal subscription transaction ${transaction.id ?? "(missing id)"} is missing time or gross_amount`,
    );
  }
  if (transaction.status !== "COMPLETED") {
    throw new Error(
      `PayPal subscription transaction ${transaction.id} is ${transaction.status ?? "unknown"}, not a completed sale`,
    );
  }
  return {
    id: transaction.id,
    state: "completed",
    amount: { total: gross.value, currency: gross.currency_code },
    billing_agreement_id: subscriptionId,
    create_time: transaction.time,
  };
}
