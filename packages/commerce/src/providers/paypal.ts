import { getPlanCredits, isSubscriptionPlan } from "../catalog.js";
import { PermanentFulfillmentError } from "../errors.js";
import { paypalAmountToMinor } from "../money.js";
import { notifyCreditGrantFailed } from "../notify.js";
import { safeUnknownError } from "../privacy.js";
import type { Commerce } from "../index.js";
import type { CanonicalSubscriptionStatus, CommerceCatalog, SubscriptionSyncInput } from "../types.js";

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 200;

export interface PayPalVerifyTransport {
  verifySignature(requestBody: string): Promise<{ status: number; verificationStatus?: string }>;
}

/** PayPal Billing Subscription resource. Mapped internally; never a SubscriptionSyncInput. */
export interface PayPalSubscriptionResource {
  id: string;
  status?: string | null;
  plan_id?: string | null;
  custom_id?: string | null;
  update_time?: string | null;
  subscriber?: { payer_id?: string | null } | null;
  billing_info?: {
    last_payment?: { time?: string | null } | null;
    next_billing_time?: string | null;
  } | null;
}

export function mapPayPalSubscriptionStatus(status: string): CanonicalSubscriptionStatus {
  switch (status) {
    case "ACTIVE": return "active";
    case "APPROVED":
    case "APPROVAL_PENDING": return "incomplete";
    case "SUSPENDED": return "past_due";
    case "CANCELLED": return "canceled";
    case "EXPIRED": return "expired";
    default: return "incomplete";
  }
}

export function buildPayPalVerifyBody(headers: {
  authAlgo: string; certUrl: string; transmissionId: string; transmissionSig: string; transmissionTime: string;
}, rawBody: string, webhookId: string): string {
  const prefix = JSON.stringify({
    auth_algo: headers.authAlgo, cert_url: headers.certUrl, transmission_id: headers.transmissionId,
    transmission_sig: headers.transmissionSig, transmission_time: headers.transmissionTime, webhook_id: webhookId,
  });
  return prefix.slice(0, -1) + ',"webhook_event":' + rawBody + "}";
}

export async function verifyPayPalWebhookSignature(params: {
  headers: { authAlgo: string; certUrl: string; transmissionId: string; transmissionSig: string; transmissionTime: string };
  rawBody: string; webhookId?: string; transport: PayPalVerifyTransport;
  sleep?: (ms: number) => Promise<void>; log?: (message: string) => void;
}): Promise<boolean> {
  if (!params.webhookId) return false;
  const requestBody = buildPayPalVerifyBody(params.headers, params.rawBody, params.webhookId);
  const sleep = params.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      if (attempt > 0) await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
      const { status, verificationStatus } = await params.transport.verifySignature(requestBody);
      if (status >= 400 && status < 500) return false;
      if (status >= 500) continue;
      return status >= 200 && status < 300 && verificationStatus === "SUCCESS";
    } catch (error) {
      params.log?.(safeUnknownError(error).message);
    }
  }
  return false;
}

function headerValue(headers: { get?(name: string): string | null } | Record<string, string | null | undefined>, name: string): string {
  if (typeof (headers as { get?: unknown }).get === "function") return (headers as { get(name: string): string | null }).get(name) ?? "";
  const record = headers as Record<string, string | null | undefined>;
  return record[name] ?? "";
}

function idFromUpLink(links: unknown): string | null {
  if (!Array.isArray(links)) return null;
  for (const link of links) {
    if (!link || typeof link !== "object") continue;
    const row = link as { rel?: string; href?: string };
    if (row.rel === "up" && typeof row.href === "string") {
      const id = row.href.split("/").filter(Boolean).pop();
      if (id) return decodeURIComponent(id);
    }
  }
  return null;
}

export function createPayPalProvider(deps: {
  webhookId: string;
  commerce: Commerce;
  catalog?: CommerceCatalog;
  transport: PayPalVerifyTransport;
  loadSubscription?: (subscriptionId: string) => Promise<PayPalSubscriptionResource | null>;
  refundSale?: (saleId: string) => Promise<void>;
}) {
  if (!deps.webhookId) throw new Error("PayPal provider is enabled but webhookId is missing");
  const catalog = deps.catalog ?? deps.commerce.runtime.catalog;

  function paypalDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  async function syncFromVendor(sub: PayPalSubscriptionResource, statusOverride?: CanonicalSubscriptionStatus): Promise<SubscriptionSyncInput | null> {
    const decoded = deps.commerce.decodePayPalCustomId(sub.custom_id);
    const source = await deps.commerce.resolveSubscriptionSource({
      provider: "paypal", subscriptionId: sub.id, externalId: sub.plan_id ?? null, metadata: decoded ?? {}, catalog,
    });
    const plan = source?.plan;
    if (!plan || !isSubscriptionPlan(plan)) return null;
    const subject = source.subject ?? await deps.commerce.resolveSubject({
      userId: decoded?.userId ?? null, organizationId: decoded?.organizationId ?? null,
    });
    const status = statusOverride ?? mapPayPalSubscriptionStatus(sub.status ?? "");
    const input: SubscriptionSyncInput = {
      provider: "paypal", providerSubscriptionId: sub.id, subject, planId: plan.id,
      providerCustomerId: sub.subscriber?.payer_id ?? null, providerPriceId: source.providerPriceId,
      status, interval: plan.interval ?? "month",
      currentPeriodStart: paypalDate(sub.billing_info?.last_payment?.time),
      currentPeriodEnd: paypalDate(sub.billing_info?.next_billing_time),
      cancelAtPeriodEnd: false,
      canceledAt: sub.status === "CANCELLED" ? (paypalDate(sub.update_time) ?? deps.commerce.runtime.deps.clock.now()) : null,
      endedAt: sub.status === "EXPIRED" ? (paypalDate(sub.update_time) ?? deps.commerce.runtime.deps.clock.now()) : null,
      monthlyCredits: plan.monthlyCredits ?? 0,
      metadata: { customId: sub.custom_id ?? null, paypalPlanId: sub.plan_id ?? null, paypalPayerId: sub.subscriber?.payer_id ?? null },
    };
    await deps.commerce.syncSubscription(input);
    if (sub.subscriber?.payer_id && subject.userId) {
      const written = await deps.commerce.runtime.withUnit(undefined, (unit) => unit.identity.writeProviderCustomerIfAbsent(
        subject.userId!, "paypal", sub.subscriber!.payer_id!, deps.commerce.runtime.deps.clock.now(),
      ));
      if (written === "conflict") deps.commerce.runtime.log("warn", { userId: subject.userId }, "User already has a different PayPal payer id");
    }
    return input;
  }

  async function requireVendorSubscription(subscriptionId: string): Promise<PayPalSubscriptionResource> {
    const loaded = await deps.loadSubscription?.(subscriptionId);
    if (!loaded?.id) {
      throw new Error(`PayPal subscription ${subscriptionId} requires loadSubscription; refusing to acknowledge an unsynced subscription`);
    }
    return loaded;
  }

  const api = {
    mapPayPalSubscriptionStatus,
    verify(headers: Parameters<typeof verifyPayPalWebhookSignature>[0]["headers"], rawBody: string) {
      return verifyPayPalWebhookSignature({ headers, rawBody, webhookId: deps.webhookId, transport: deps.transport });
    },
    async fulfillCapture(params: { captureId: string; customId?: string | null; sourceOrderId?: string | null; amountValue?: string | null; currencyCode?: string | null; metadata?: Record<string, unknown>; payerId?: string | null }) {
      const decoded = deps.commerce.decodePayPalCustomId(params.customId);
      const echo = decoded ? (catalog ?? deps.commerce.runtime.catalog).getPlanById(decoded.planId) : null;
      if (echo?.provider === "paypal" && isSubscriptionPlan(echo)) return { created: false, planId: echo.id };
      const { bound, plan } = await deps.commerce.boundPayPalCapture(params);
      const result = await deps.commerce.fulfillOneTimePurchase({
        provider: "paypal", providerOrderId: bound.providerOrderId, providerPaymentId: params.captureId,
        subject: { userId: bound.userId, organizationId: bound.organizationId }, planId: plan.id,
        credits: getPlanCredits(plan), amountTotal: bound.amountTotal, currency: bound.currency,
        metadata: { ...(bound.metadata ?? {}), ...(params.metadata ?? {}), paypalCaptureId: params.captureId },
      });
      if (params.payerId && bound.userId) {
        await deps.commerce.runtime.withUnit(undefined, (unit) => unit.identity.writeProviderCustomerIfAbsent(bound.userId!, "paypal", params.payerId!, deps.commerce.runtime.deps.clock.now()));
      }
      return { ...result, planId: plan.id };
    },
    async saleCompleted(sale: { id: string; billingAgreementId?: string | null; amount: string; currency: string; createTime?: string | null }, sync: SubscriptionSyncInput) {
      const prior = await deps.commerce.runtime.withUnit(undefined, (unit) => unit.subscriptions.countOtherSubscriptionOrders("paypal", sync.providerSubscriptionId, sale.id));
      // countOther excludes this sale id. A prior initial/renewal order means renewal.
      const orderType = prior > 0 ? "subscription_renewal" : "subscription_initial";
      const amountTotal = paypalAmountToMinor(sale.amount);
      const currency = sale.currency.toLowerCase();
      const result = await deps.commerce.fulfillSubscriptionPayment({
        subscription: sync, orderType, providerOrderId: sale.id, providerPaymentId: sale.id,
        amountTotal, currency,
        periodStart: sale.createTime ? new Date(sale.createTime) : sync.currentPeriodStart,
        metadata: { paypalSaleId: sale.id, paypalSubscriptionId: sync.providerSubscriptionId },
      });
      if (result.duplicate) {
        await deps.commerce.settleDuplicateSubscription({
          provider: "paypal", providerSubscriptionId: sync.providerSubscriptionId, providerOrderId: sale.id,
          winner: result.duplicate, amountTotal, currency, userId: sync.subject.userId,
          refund: deps.refundSale ? async () => {
            try { await deps.refundSale!(sale.id); }
            catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              const mapped = paypalPermanentRefund(message, sale.id);
              if (mapped.message === "already-refunded") return;
              throw mapped;
            }
          } : undefined,
        });
      }
      return result;
    },
    async refundCapture(resource: { id?: string; captureId: string; officialCumulative?: string | null; eventAmount?: string | null }) {
      if (!resource.id) throw new Error("PayPal capture refund has no stable refund id");
      if (!resource.officialCumulative && !resource.eventAmount) {
        throw new Error(`PayPal refund ${resource.id} has neither an official cumulative total nor an event amount`);
      }
      const result = await deps.commerce.applyRefund({
        provider: "paypal", providerPaymentId: resource.captureId,
        amountRefunded: paypalAmountToMinor(resource.officialCumulative ?? resource.eventAmount),
        cumulative: resource.officialCumulative != null, refundId: resource.id,
      });
      if (!result.orderFound) throw new Error(`PayPal refund ${resource.id}: no local order for capture ${resource.captureId} — retrying until the completed-capture order lands`);
      if (result.fullRefundOfSubscription && result.providerSubscriptionId) {
        await deps.commerce.runtime.deps.cancelSubscription?.("paypal", result.providerSubscriptionId, "Fully refunded");
      }
      return result;
    },
    webhook() {
      return async (rawBody: string, headers: { get?(name: string): string | null } | Record<string, string | null | undefined>) => {
        const webhookHeaders = {
          authAlgo: headerValue(headers, "paypal-auth-algo"),
          certUrl: headerValue(headers, "paypal-cert-url"),
          transmissionId: headerValue(headers, "paypal-transmission-id"),
          transmissionSig: headerValue(headers, "paypal-transmission-sig"),
          transmissionTime: headerValue(headers, "paypal-transmission-time"),
        };
        if (Object.values(webhookHeaders).some((value) => !value)) {
          return { status: 400, body: { error: "Missing PayPal webhook signature headers." } };
        }
        const valid = await api.verify(webhookHeaders, rawBody);
        if (!valid) return { status: 400, body: { error: "Webhook signature verification failed." } };
        let event: { event_type?: string; resource?: Record<string, unknown> };
        try { event = JSON.parse(rawBody) as typeof event; }
        catch { return { status: 400, body: { error: "Invalid JSON payload." } }; }
        const eventType = event.event_type ?? "";
        const resource = event.resource ?? {};
        try {
          switch (eventType) {
            case "PAYMENT.CAPTURE.COMPLETED": {
              if (resource.status && resource.status !== "COMPLETED") break;
              const related = resource.supplementary_data as { related_ids?: { order_id?: string } } | undefined;
              await api.fulfillCapture({
                captureId: String(resource.id ?? ""),
                customId: typeof resource.custom_id === "string" ? resource.custom_id : null,
                sourceOrderId: related?.related_ids?.order_id ?? null,
                amountValue: amountField(resource.amount, "value"),
                currencyCode: amountField(resource.amount, "currency_code"),
                metadata: { paypalCaptureId: resource.id ?? null, customId: resource.custom_id ?? null },
                payerId: typeof resource.payer_id === "string" ? resource.payer_id : null,
              });
              break;
            }
            case "PAYMENT.CAPTURE.PENDING": {
              const related = resource.supplementary_data as { related_ids?: { order_id?: string } } | undefined;
              const bound = await deps.commerce.boundPayPalCapture({
                captureId: String(resource.id ?? ""),
                customId: typeof resource.custom_id === "string" ? resource.custom_id : null,
                sourceOrderId: related?.related_ids?.order_id ?? null,
                amountValue: amountField(resource.amount, "value"),
                currencyCode: amountField(resource.amount, "currency_code"),
              });
              await deps.commerce.attachPendingPayPalCapture(bound.bound.id, String(resource.id ?? ""), {
                paypalCaptureId: resource.id ?? null, customId: resource.custom_id ?? null,
              });
              break;
            }
            case "PAYMENT.CAPTURE.DENIED":
            case "PAYMENT.CAPTURE.DECLINED": {
              const captureId = String(resource.id ?? "");
              await deps.commerce.runtime.withUnit(undefined, (unit) => unit.orders.markPendingFailed("paypal", captureId, deps.commerce.runtime.deps.clock.now()));
              const decoded = deps.commerce.decodePayPalCustomId(typeof resource.custom_id === "string" ? resource.custom_id : null);
              await deps.commerce.runtime.deps.notifier?.onPaymentDenied?.({
                provider: "paypal", providerPaymentId: captureId, planId: decoded?.planId ?? "unknown", userId: decoded?.userId ?? "unknown",
              });
              break;
            }
            case "PAYMENT.CAPTURE.REFUNDED":
            case "PAYMENT.CAPTURE.REVERSED": {
              const captureId = idFromUpLink(resource.links) ?? (typeof resource.id === "string" ? resource.id : null);
              if (!captureId) throw new Error('PayPal refund/reversal carries neither an "up" link nor a resource id');
              const breakdown = resource.seller_payable_breakdown as { total_refunded_amount?: { value?: string } } | undefined;
              await api.refundCapture({
                id: typeof resource.id === "string" ? resource.id : undefined,
                captureId,
                officialCumulative: breakdown?.total_refunded_amount?.value ?? null,
                eventAmount: amountField(resource.amount, "value"),
              });
              break;
            }
            case "PAYMENT.SALE.COMPLETED": {
              const subscriptionId = typeof resource.billing_agreement_id === "string" ? resource.billing_agreement_id : null;
              if (!subscriptionId) break;
              const loaded = await requireVendorSubscription(subscriptionId);
              const sync = await syncFromVendor(loaded);
              if (!sync) throw new Error(`PayPal sale ${String(resource.id ?? "")} did not resolve to a subscription plan`);
              const amount = resource.amount as { total?: string; currency?: string } | undefined;
              await api.saleCompleted({
                id: String(resource.id ?? ""), billingAgreementId: subscriptionId,
                amount: amount?.total ?? "", currency: amount?.currency ?? "USD",
                createTime: typeof resource.create_time === "string" ? resource.create_time : null,
              }, sync);
              break;
            }
            case "PAYMENT.SALE.REFUNDED":
            case "PAYMENT.SALE.REVERSED": {
              const saleId = typeof resource.sale_id === "string" ? resource.sale_id : idFromUpLink(resource.links);
              if (!saleId) throw new Error(`PayPal refund ${String(resource.id ?? "")} carries neither sale_id nor an "up" link`);
              const total = resource.total_refunded_amount as { value?: string } | undefined;
              const amount = resource.amount as { total?: string } | undefined;
              await api.refundCapture({
                id: typeof resource.id === "string" ? resource.id : undefined,
                captureId: saleId,
                officialCumulative: total?.value ?? null,
                eventAmount: amount?.total ?? null,
              });
              break;
            }
            case "BILLING.SUBSCRIPTION.ACTIVATED":
            case "BILLING.SUBSCRIPTION.UPDATED":
            case "BILLING.SUBSCRIPTION.SUSPENDED": {
              const id = typeof resource.id === "string" ? resource.id : null;
              if (!id) throw new Error(`PayPal ${eventType} has no subscription id`);
              const loaded = await requireVendorSubscription(id);
              const sync = await syncFromVendor(loaded);
              if (!sync) throw new Error(`PayPal ${eventType} ${id} did not resolve to a subscription plan`);
              break;
            }
            case "BILLING.SUBSCRIPTION.PAYMENT.FAILED":
            case "BILLING.SUBSCRIPTION.CANCELLED":
            case "BILLING.SUBSCRIPTION.EXPIRED": {
              const id = typeof resource.id === "string" ? resource.id : null;
              if (!id) break;
              if (eventType === "BILLING.SUBSCRIPTION.PAYMENT.FAILED") {
                if (deps.loadSubscription) {
                  const loaded = await requireVendorSubscription(id);
                  const sync = await syncFromVendor(loaded, "past_due");
                  if (!sync) throw new Error(`PayPal subscription payment failed for ${id} and did not resolve to a plan`);
                } else {
                  await deps.commerce.runtime.withUnit(undefined, async (unit) => {
                    const row = await unit.subscriptions.lockByKey("paypal", id);
                    if (!row || row.status === "canceled" || row.status === "expired") return;
                    await unit.subscriptions.update("paypal", id, { status: "past_due", updatedAt: deps.commerce.runtime.deps.clock.now() });
                  });
                }
                deps.commerce.runtime.log("warn", { providerSubscriptionId: id }, "PayPal subscription payment failed");
                break;
              }
              if (deps.loadSubscription) {
                try {
                  const loaded = await requireVendorSubscription(id);
                  await syncFromVendor(loaded);
                } catch (error) {
                  deps.commerce.runtime.log("error", { providerSubscriptionId: id, err: safeUnknownError(error) }, "Failed to refresh PayPal subscription before ending it");
                }
              }
              const status = mapPayPalSubscriptionStatus(typeof resource.status === "string" ? resource.status : "");
              await deps.commerce.handleSubscriptionEnded("paypal", id, {
                status: status === "expired" ? "expired" : "canceled",
              });
              break;
            }
            default:
              break;
          }
          return { status: 200, body: { received: true } };
        } catch (error) {
          deps.commerce.runtime.log("error", { eventType, err: safeUnknownError(error) }, "PayPal webhook handler failed");
          if (eventType === "PAYMENT.CAPTURE.COMPLETED" || eventType === "PAYMENT.SALE.COMPLETED") {
            const decoded = deps.commerce.decodePayPalCustomId(typeof resource.custom_id === "string" ? resource.custom_id : typeof resource.custom === "string" ? resource.custom : null);
            await notifyCreditGrantFailed(deps.commerce.runtime, {
              userId: decoded?.userId ?? "unknown",
              orderId: typeof resource.id === "string" ? resource.id : "unknown",
              planId: decoded?.planId ?? "unknown",
              error,
            });
          }
          if (error instanceof PermanentFulfillmentError) return { status: 200, body: { received: true, permanentError: true } };
          return { status: 500, body: { error: "Failed to process PayPal webhook." } };
        }
      };
    },
  };
  return api;
}

function amountField(amount: unknown, key: "value" | "currency_code"): string | null {
  if (!amount || typeof amount !== "object") return null;
  const value = (amount as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

export function paypalPermanentRefund(message: string, saleId: string): Error {
  if (/CAPTURE_FULLY_REFUNDED/i.test(message)) return new Error("already-refunded");
  if (/RESOURCE_NOT_FOUND|INVALID_RESOURCE_ID|\b404\b/i.test(message)) {
    return new PermanentFulfillmentError(`PayPal refuses to refund sale ${saleId} (${message}) — refund it manually in the PayPal dashboard`);
  }
  return new Error(message);
}
