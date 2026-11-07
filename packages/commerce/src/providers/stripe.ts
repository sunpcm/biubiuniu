import { getPlanCredits, isSubscriptionPlan, resolvePlanBySource } from "../catalog.js";
import { PermanentFulfillmentError } from "../errors.js";
import { notifyCreditGrantFailed, notifyInvoicePaymentFailed } from "../notify.js";
import { safeUnknownError } from "../privacy.js";
import { loadOptionalSdk } from "./load-sdk.js";
import type { Commerce } from "../index.js";
import type {
  CanonicalSubscriptionStatus,
  CommerceCatalog,
  SubscriptionSyncInput,
} from "../types.js";

export interface StripeLikeEvent {
  id?: string;
  type: string;
  data: { object: unknown };
}

export interface StripeList<T> {
  data?: T[];
  has_more?: boolean;
}

export interface StripeCheckoutSession {
  id: string;
  mode?: string | null;
  payment_status?: string | null;
  metadata?: Record<string, string> | null;
  customer?: string | { id?: string | null } | null;
  payment_intent?: string | { id?: string | null } | null;
  amount_total?: number | null;
  amount_subtotal?: number | null;
  total_details?: { amount_discount?: number | null; amount_tax?: number | null } | null;
  currency?: string | null;
  line_items?: StripeList<{
    price?: string | { id?: string | null } | null;
    quantity?: number | null;
  }> | null;
}

export interface StripeSubscription {
  id: string;
  status?: string | null;
  customer?: string | { id?: string | null } | null;
  metadata?: Record<string, string> | null;
  cancel_at_period_end?: boolean | null;
  canceled_at?: number | null;
  ended_at?: number | null;
  items?: StripeList<{
    price?: string | { id?: string | null } | null;
    current_period_start?: number | null;
    current_period_end?: number | null;
  }>;
}

export interface StripeInvoice {
  id?: string | null;
  status?: string | null;
  currency?: string | null;
  amount_paid?: number | null;
  amount_due?: number | null;
  next_payment_attempt?: number | null;
  subtotal?: number | null;
  billing_reason?: string | null;
  parent?: {
    subscription_details?: { subscription?: string | { id?: string | null } | null } | null;
  } | null;
  total_discount_amounts?: { amount?: number | null }[] | null;
  total_taxes?: { amount?: number | null }[] | null;
  payments?: {
    data?: { payment?: { payment_intent?: string | { id?: string | null } | null } | null }[];
  } | null;
}

export interface StripeCustomer {
  id?: string;
  deleted?: boolean | void;
  metadata?: { userId?: string | null } | null;
}

/**
 * The real SDK shape used by webhook fulfillment. `webhooks` verifies the
 * signed event; the resource methods cover fields Stripe does not expand in
 * webhook payloads. Each optional method is supplied through a bound wrapper
 * by the app adapter so Stripe's resource receiver and request config survive.
 */
export interface StripeWebhookClient {
  webhooks: { constructEvent(payload: string, signature: string, secret: string): StripeLikeEvent };
  checkout?: {
    sessions?: {
      listLineItems?: (
        id: string,
        params?: { limit?: number },
      ) => Promise<StripeCheckoutSession["line_items"]>;
    };
  };
  subscriptions?: { retrieve?: (id: string) => Promise<StripeSubscription> };
  invoices?: { retrieve?: (id: string, params?: { expand?: string[] }) => Promise<StripeInvoice> };
  customers?: { retrieve?: (id: string) => Promise<StripeCustomer> };
}

export function mapStripeSubscriptionStatus(status: string): CanonicalSubscriptionStatus {
  if (status === "incomplete_expired") return "expired";
  switch (status) {
    case "active":
    case "trialing":
    case "past_due":
    case "unpaid":
    case "canceled":
    case "incomplete":
    case "paused":
      return status;
    default:
      return "incomplete";
  }
}

export function resolveStripePlan(
  catalog: CommerceCatalog,
  metadataPlanId: string | null,
  priceId: string | null,
) {
  return resolvePlanBySource({ provider: "stripe", metadataPlanId, externalId: priceId }, catalog);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requireEventObject(value: unknown): Record<string, unknown> {
  const object = asRecord(value);
  if (!object) throw new Error("Stripe webhook event data.object must be an object");
  return object;
}

function idOf(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  const record = asRecord(value);
  return record && typeof record.id === "string" ? record.id : null;
}

function unixToDate(seconds: unknown): Date | null {
  return typeof seconds === "number" && Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
}

function priceIdOf(price: unknown): string | null {
  return idOf(price);
}

function sumAmounts(rows: { amount?: number | null }[] | null | undefined): number {
  return (
    rows?.reduce((sum, row) => sum + (typeof row.amount === "number" ? row.amount : 0), 0) ?? 0
  );
}

function ackPermanent(error: unknown) {
  if (error instanceof PermanentFulfillmentError)
    return { status: 200, body: { received: true, permanentError: true } };
  return { status: 500, body: { error: "Failed to process Stripe webhook." } };
}

function isStripeAlreadyRefunded(error: unknown): boolean {
  return asRecord(error)?.code === "charge_already_refunded";
}

export async function createStripeProvider(deps: {
  commerce: Commerce;
  webhookSecret?: string;
  apiKey?: string;
  client?: StripeWebhookClient;
  catalog?: CommerceCatalog;
  lineItems?: (sessionId: string) => Promise<NonNullable<StripeCheckoutSession["line_items"]>>;
  getSubscription?: (id: string) => Promise<StripeSubscription>;
  getInvoice?: (id: string) => Promise<StripeInvoice>;
  getCustomer?: (id: string) => Promise<StripeCustomer | null>;
  refundPaymentIntent?: (paymentIntentId: string, idempotencyKey: string) => Promise<void>;
}) {
  if (!deps.webhookSecret)
    throw new Error("Stripe provider is enabled but webhookSecret is missing");
  let sdk = deps.client;
  if (!sdk) {
    if (!deps.apiKey) throw new Error("Stripe provider is enabled but apiKey is missing");
    const loaded = await loadOptionalSdk("stripe", "Stripe");
    const ctor = (loaded.default ?? loaded.Stripe) as new (key: string) => StripeWebhookClient;
    if (typeof ctor !== "function")
      throw new Error(
        'Stripe provider is enabled but the optional peer dependency "stripe" did not export a client',
      );
    sdk = new ctor(deps.apiKey);
  }
  if (typeof sdk.webhooks?.constructEvent !== "function") {
    throw new Error("Stripe provider client must provide webhooks.constructEvent");
  }
  const catalog = deps.catalog ?? deps.commerce.runtime.catalog;
  const webhookClient = sdk;

  async function listLineItems(sessionId: string) {
    if (deps.lineItems) return deps.lineItems(sessionId);
    const sessions = webhookClient.checkout?.sessions;
    if (!sessions?.listLineItems) {
      throw new Error(
        "Stripe checkout line items require an injected lineItems port or a Stripe client with checkout.sessions.listLineItems",
      );
    }
    return sessions.listLineItems(sessionId, { limit: 2 });
  }

  async function loadSubscription(id: string) {
    if (deps.getSubscription) return deps.getSubscription(id);
    const retrieve = webhookClient.subscriptions?.retrieve;
    if (!retrieve)
      throw new Error(
        "Stripe subscription lookup requires an injected getSubscription port or a Stripe client with subscriptions.retrieve",
      );
    return retrieve.call(webhookClient.subscriptions, id);
  }

  async function loadInvoice(id: string) {
    if (deps.getInvoice) return deps.getInvoice(id);
    const retrieve = webhookClient.invoices?.retrieve;
    if (!retrieve)
      throw new Error(
        "Stripe invoice lookup requires an injected getInvoice port or a Stripe client with invoices.retrieve",
      );
    return retrieve.call(webhookClient.invoices, id, { expand: ["payments"] });
  }

  async function loadCustomer(id: string) {
    if (deps.getCustomer) return deps.getCustomer(id);
    const retrieve = webhookClient.customers?.retrieve;
    if (!retrieve)
      throw new Error(
        "Stripe customer lookup requires an injected getCustomer port or a Stripe client with customers.retrieve",
      );
    return retrieve.call(webhookClient.customers, id);
  }

  async function resolveStripeSubject(
    metadata: Record<string, string> | null | undefined,
    customerId: string | null,
  ) {
    const organizationId = metadata?.organizationId ?? null;
    const subject = await deps.commerce.resolveSubject({
      userId: metadata?.userId ?? null,
      organizationId,
    });
    if (!customerId) return subject;
    const mapped = await deps.commerce.runtime.withUnit(undefined, (unit) =>
      unit.identity.findUserIdByProviderCustomer("stripe", customerId),
    );
    if (subject.userId && mapped && subject.userId !== mapped) {
      throw new Error("Stripe checkout customer ownership conflict");
    }
    if (subject.userId) return subject;
    if (mapped) return deps.commerce.resolveSubject({ userId: mapped, organizationId });
    const customer = await loadCustomer(customerId);
    const fromCustomer =
      customer && customer.deleted !== true ? (customer.metadata?.userId ?? null) : null;
    return fromCustomer
      ? deps.commerce.resolveSubject({ userId: fromCustomer, organizationId })
      : subject;
  }

  async function buildSyncInput(
    stripeSub: StripeSubscription,
  ): Promise<SubscriptionSyncInput | null> {
    const items = stripeSub.items?.data ?? [];
    if (items.length !== 1 || stripeSub.items?.has_more)
      throw new Error("Subscription must have one product");
    const priceId = priceIdOf(items[0]?.price);
    const source = await deps.commerce.resolveSubscriptionSource({
      provider: "stripe",
      subscriptionId: stripeSub.id,
      externalId: priceId,
      metadata: stripeSub.metadata ?? {},
      catalog,
    });
    const plan = source?.plan;
    if (!plan || !isSubscriptionPlan(plan)) return null;
    const subject =
      source.subject ?? (await resolveStripeSubject(stripeSub.metadata, idOf(stripeSub.customer)));
    const item = items[0];
    return {
      provider: "stripe",
      providerSubscriptionId: stripeSub.id,
      subject,
      planId: plan.id,
      providerCustomerId: idOf(stripeSub.customer),
      providerPriceId: source.providerPriceId,
      status: mapStripeSubscriptionStatus(stripeSub.status ?? ""),
      interval: plan.interval ?? "month",
      currentPeriodStart: unixToDate(item?.current_period_start),
      currentPeriodEnd: unixToDate(item?.current_period_end),
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false,
      canceledAt: unixToDate(stripeSub.canceled_at),
      endedAt: unixToDate(stripeSub.ended_at),
      monthlyCredits: plan.monthlyCredits ?? 0,
    };
  }

  function paymentIntentId(invoice: StripeInvoice): string | null {
    return idOf(invoice.payments?.data?.[0]?.payment?.payment_intent);
  }

  const api = {
    mapStripeSubscriptionStatus,
    resolveStripePlan: (metadataPlanId: string | null, priceId: string | null) =>
      resolveStripePlan(catalog, metadataPlanId, priceId),
    async fulfillCheckout(session: StripeCheckoutSession) {
      if (session.mode !== "payment") return;
      if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required")
        return;
      const subject = await resolveStripeSubject(session.metadata, idOf(session.customer));
      if (!subject.userId)
        throw new PermanentFulfillmentError(
          `Cannot resolve user for checkout session ${session.id} — check metadata.userId`,
        );
      const lineItems = session.line_items ?? (await listLineItems(session.id));
      if (
        !lineItems ||
        lineItems.has_more ||
        lineItems.data?.length !== 1 ||
        lineItems.data[0]?.quantity !== 1
      ) {
        throw new Error("Checkout must carry exactly one price and quantity one");
      }
      const priceId = priceIdOf(lineItems.data?.[0]?.price);
      if (!priceId)
        throw new Error(
          `Cannot resolve external price id for checkout session ${session.id} — retrying until line items are available`,
        );
      const plan = deps.commerce.resolvePlanBySource(
        {
          provider: "stripe",
          metadataPlanId: session.metadata?.planId ?? null,
          externalId: priceId,
        },
        catalog,
      );
      if (!plan || plan.kind !== "credit_pack")
        throw new Error(
          `Cannot resolve credit pack plan for checkout session ${session.id} (planId: ${session.metadata?.planId})`,
        );
      await deps.commerce.fulfillOneTimePurchase({
        provider: "stripe",
        providerOrderId: session.id,
        providerPaymentId: idOf(session.payment_intent),
        subject,
        planId: plan.id,
        credits: getPlanCredits(plan),
        amountTotal: session.amount_total ?? 0,
        amountSubtotal: session.amount_subtotal,
        amountDiscount: session.total_details?.amount_discount ?? 0,
        amountTax: session.total_details?.amount_tax ?? 0,
        currency: session.currency ?? "usd",
        metadata: session.metadata ?? null,
      });
    },
    async fulfillInvoice(invoice: StripeInvoice) {
      const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription);
      if (invoice.status !== "paid" || !subscriptionId || !invoice.id) return;
      const stripeSub = await loadSubscription(subscriptionId);
      const invoiceId = invoice.id;
      const resolvePaymentIntent = async () =>
        paymentIntentId(invoice) ?? paymentIntentId(await loadInvoice(invoiceId));
      if (
        invoice.billing_reason !== "subscription_create" &&
        invoice.billing_reason !== "subscription_cycle"
      ) {
        if (invoice.billing_reason === "subscription_update") {
          const built = await buildSyncInput(stripeSub);
          if (!built)
            throw new Error(
              `Cannot fulfill invoice ${invoice.id}: subscription ${subscriptionId} did not resolve to a plan`,
            );
          const paymentIntent = await resolvePaymentIntent();
          await deps.commerce.fulfillSubscriptionUpgrade({
            subscription: built,
            providerOrderId: invoice.id,
            providerPaymentId: paymentIntent,
            amountTotal: invoice.amount_paid ?? 0,
            amountSubtotal: invoice.subtotal,
            amountDiscount: sumAmounts(invoice.total_discount_amounts),
            amountTax: sumAmounts(invoice.total_taxes),
            currency: invoice.currency ?? "usd",
            metadata: { billingReason: invoice.billing_reason },
          });
          return;
        }
        const synced = await buildSyncInput(stripeSub);
        if (synced) await deps.commerce.syncSubscription(synced);
        return;
      }
      const built = await buildSyncInput(stripeSub);
      if (!built)
        throw new Error(
          `Cannot fulfill invoice ${invoice.id}: subscription ${subscriptionId} did not resolve to a plan`,
        );
      const paymentIntent = await resolvePaymentIntent();
      const result = await deps.commerce.fulfillSubscriptionPayment({
        subscription: built,
        orderType:
          invoice.billing_reason === "subscription_create"
            ? "subscription_initial"
            : "subscription_renewal",
        providerOrderId: invoice.id,
        providerPaymentId: paymentIntent,
        amountTotal: invoice.amount_paid ?? 0,
        amountSubtotal: invoice.subtotal,
        amountDiscount: sumAmounts(invoice.total_discount_amounts),
        amountTax: sumAmounts(invoice.total_taxes),
        currency: invoice.currency ?? "usd",
        periodStart: built.currentPeriodStart,
        metadata: { billingReason: invoice.billing_reason },
      });
      if (result.duplicate) {
        if (paymentIntent && !deps.refundPaymentIntent) {
          throw new Error(
            "Stripe duplicate settlement requires an injected refundPaymentIntent port; refusing to acknowledge an unsettled duplicate",
          );
        }
        await deps.commerce.settleDuplicateSubscription({
          provider: "stripe",
          providerSubscriptionId: subscriptionId,
          providerOrderId: invoice.id,
          winner: result.duplicate,
          amountTotal: invoice.amount_paid ?? 0,
          currency: invoice.currency ?? "usd",
          userId: built.subject.userId,
          refund: paymentIntent
            ? async () => {
                try {
                  await deps.refundPaymentIntent!(paymentIntent, `dup-refund-${invoice.id}`);
                } catch (error) {
                  if (!isStripeAlreadyRefunded(error)) throw error;
                }
              }
            : undefined,
        });
      }
    },
    async syncSubscription(stripeSub: StripeSubscription) {
      const built = await buildSyncInput(stripeSub);
      if (built) await deps.commerce.syncSubscription(built);
      return built;
    },
    async applyChargeRefund(charge: {
      id?: string;
      payment_intent?: string | { id?: string | null } | null;
      amount_refunded?: number | null;
    }) {
      const paymentIntent = idOf(charge.payment_intent);
      if (!paymentIntent) return;
      if (
        typeof charge.amount_refunded !== "number" ||
        !Number.isSafeInteger(charge.amount_refunded)
      ) {
        throw new Error(
          `Stripe refund for charge ${charge.id ?? "unknown"} has no integer amount_refunded`,
        );
      }
      const result = await deps.commerce.applyRefund({
        provider: "stripe",
        providerPaymentId: paymentIntent,
        amountRefunded: charge.amount_refunded,
        cumulative: true,
        refundId: charge.id ?? null,
      });
      if (!result.orderFound)
        throw new Error(
          `Stripe refund for charge ${charge.id}: no local order for payment intent ${paymentIntent} — retrying until the order lands`,
        );
      if (result.fullRefundOfSubscription && result.providerSubscriptionId) {
        await deps.commerce.runtime.deps.cancelSubscription?.(
          "stripe",
          result.providerSubscriptionId,
          "Fully refunded",
        );
      }
      return result;
    },
    webhook() {
      return async (rawBody: string, signature: string | null) => {
        if (!signature)
          return { status: 400, body: { error: "Webhook signature verification failed." } };
        let event: StripeLikeEvent;
        try {
          event = webhookClient.webhooks.constructEvent(rawBody, signature, deps.webhookSecret!);
        } catch (error) {
          deps.commerce.runtime.log(
            "warn",
            { err: safeUnknownError(error) },
            "Stripe webhook signature verification failed",
          );
          return { status: 400, body: { error: "Webhook signature verification failed." } };
        }
        try {
          const object = requireEventObject(event.data.object);
          switch (event.type) {
            case "checkout.session.completed":
              await api.fulfillCheckout(object as unknown as StripeCheckoutSession);
              break;
            case "invoice.paid":
              await api.fulfillInvoice(object as unknown as StripeInvoice);
              break;
            case "customer.subscription.created":
            case "customer.subscription.updated":
              await api.syncSubscription(object as unknown as StripeSubscription);
              break;
            case "customer.subscription.deleted": {
              const stripeSub = object as unknown as StripeSubscription;
              if (!stripeSub.id) break;
              await api.syncSubscription(stripeSub);
              await deps.commerce.handleSubscriptionEnded("stripe", stripeSub.id, {
                status: mapStripeSubscriptionStatus(stripeSub.status ?? "canceled"),
                canceledAt: unixToDate(stripeSub.canceled_at),
                endedAt: unixToDate(stripeSub.ended_at),
              });
              break;
            }
            case "charge.refunded":
              await api.applyChargeRefund(
                object as {
                  id?: string;
                  payment_intent?: string | null;
                  amount_refunded?: number | null;
                },
              );
              break;
            case "invoice.payment_failed": {
              const invoice = object as unknown as StripeInvoice;
              const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription);
              if (!subscriptionId) break;
              const stripeSub = await loadSubscription(subscriptionId);
              const built = await api.syncSubscription(stripeSub);
              const userId = built?.subject.userId ?? null;
              if (!userId) break;
              await notifyInvoicePaymentFailed(deps.commerce.runtime, {
                userId,
                invoiceId: invoice.id ?? null,
                subscriptionId,
                planId: stripeSub.metadata?.planId ?? null,
                amountDue: typeof invoice.amount_due === "number" ? invoice.amount_due / 100 : null,
                currency: invoice.currency ?? null,
                nextPaymentAttemptDate:
                  typeof invoice.next_payment_attempt === "number"
                    ? new Date(invoice.next_payment_attempt * 1000).toLocaleDateString()
                    : null,
              });
              break;
            }
            default:
              break;
          }
          return { status: 200, body: { received: true } };
        } catch (error) {
          deps.commerce.runtime.log(
            "error",
            { eventType: event.type, err: safeUnknownError(error) },
            "Stripe webhook handler failed",
          );
          if (event.type === "checkout.session.completed" || event.type === "invoice.paid") {
            const object = asRecord(event.data.object);
            const metadata = asRecord(object?.metadata);
            await notifyCreditGrantFailed(deps.commerce.runtime, {
              userId: typeof metadata?.userId === "string" ? metadata.userId : "unknown",
              orderId: typeof object?.id === "string" ? object.id : "unknown",
              planId: typeof metadata?.planId === "string" ? metadata.planId : "unknown",
              error,
            });
          }
          return ackPermanent(error);
        }
      };
    },
    isSubscriptionPlan,
  };
  return api;
}

export { notifyInvoicePaymentFailed };
