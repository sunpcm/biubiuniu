import { getPlanCredits, isSubscriptionPlan, resolvePlanBySource } from "../catalog.js";
import { PermanentFulfillmentError } from "../errors.js";
import { notifyCreditGrantFailed } from "../notify.js";
import { safeUnknownError } from "../privacy.js";
import { loadOptionalSdk } from "./load-sdk.js";
import type { Commerce } from "../index.js";
import type {
  CanonicalSubscriptionStatus,
  CommerceCatalog,
  SubscriptionSyncInput,
} from "../types.js";

const HANDLED_EVENTS = new Set([
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
const MONEY_EVENTS = new Set(["checkout.completed", "subscription.paid"]);

export interface CreemWebhookEnvelope {
  type: string;
  data?: unknown;
  id?: string;
}

export interface CreemWebhookEntity {
  eventType: string;
  object: unknown;
}

/** Real `creem/webhooks` exports. Verification takes the secret string. */
export interface CreemWebhookSdk {
  verifyWebhookSignature(payload: string, headers: Headers, secret: string): Promise<void>;
  parseWebhookEvent(payload: string): CreemWebhookEnvelope;
  parseWebhookEventEntity(payload: string): CreemWebhookEntity;
}

export interface CreemSubscription {
  id: string;
  status?: string;
  product?: unknown;
  customer?: unknown;
  items?: { productId?: string | null }[] | null;
  metadata?: Record<string, unknown> | null;
  lastTransaction?: CreemTransaction | null;
  currentPeriodStartDate?: Date | string | null;
  currentPeriodEndDate?: Date | string | null;
  canceledAt?: Date | string | null;
}

export interface CreemTransaction {
  id?: string;
  status?: string;
  amount?: number | null;
  amountPaid?: number | null;
  discountAmount?: number | null;
  taxAmount?: number | null;
  currency?: string;
  refundedAmount?: number | null;
  periodStart?: number | null;
}

export function mapCreemSubscriptionStatus(status: string): CanonicalSubscriptionStatus {
  switch (status) {
    case "active":
    case "trialing":
    case "past_due":
    case "unpaid":
    case "canceled":
    case "expired":
    case "paused":
      return status;
    case "scheduled_cancel":
      return "active";
    default:
      return "incomplete";
  }
}

export function resolveCreemPlan(
  catalog: CommerceCatalog,
  metadataPlanId: string | null,
  productId: string | null,
) {
  return resolvePlanBySource({ provider: "creem", metadataPlanId, externalId: productId }, catalog);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asMetadata(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? {};
}

function idOf(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  const record = asRecord(value);
  return record && typeof record.id === "string" ? record.id : null;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function epochToDate(value: unknown): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return null;
  return new Date(value > 1e12 ? value : value * 1000);
}

export async function createCreemProvider(deps: {
  commerce: Commerce;
  webhookSecret?: string;
  catalog?: CommerceCatalog;
  webhooks?: CreemWebhookSdk;
  getSubscription?: (subscriptionId: string) => Promise<CreemSubscription>;
  refundTransaction?: (transactionId: string) => Promise<void>;
}) {
  if (!deps.webhookSecret)
    throw new Error("Creem provider is enabled but webhookSecret is missing");
  let webhooks = deps.webhooks;
  if (!webhooks) {
    const loaded = await loadOptionalSdk("creem/webhooks", "Creem");
    const verifyWebhookSignature = loaded.verifyWebhookSignature as
      | CreemWebhookSdk["verifyWebhookSignature"]
      | undefined;
    const parseWebhookEvent = loaded.parseWebhookEvent as
      | CreemWebhookSdk["parseWebhookEvent"]
      | undefined;
    const parseWebhookEventEntity = loaded.parseWebhookEventEntity as
      | CreemWebhookSdk["parseWebhookEventEntity"]
      | undefined;
    if (!verifyWebhookSignature || !parseWebhookEvent || !parseWebhookEventEntity) {
      throw new Error(
        'Creem provider is enabled but the optional peer dependency "creem" did not export webhook helpers',
      );
    }
    webhooks = { verifyWebhookSignature, parseWebhookEvent, parseWebhookEventEntity };
  }
  if (
    typeof webhooks.verifyWebhookSignature !== "function" ||
    typeof webhooks.parseWebhookEvent !== "function" ||
    typeof webhooks.parseWebhookEventEntity !== "function"
  ) {
    throw new Error(
      'Creem provider is enabled but the optional peer dependency "creem" did not export webhook helpers',
    );
  }
  const catalog = deps.catalog ?? deps.commerce.runtime.catalog;
  const sdk = webhooks;

  async function resolveCreemSubject(metadata: Record<string, unknown>, customerId: string | null) {
    const organizationId =
      typeof metadata.organizationId === "string" ? metadata.organizationId : null;
    const candidate = await deps.commerce.resolveSubject({
      userId: typeof metadata.userId === "string" ? metadata.userId : null,
      organizationId,
    });
    if (!customerId) return candidate;
    const customerUserId = await deps.commerce.runtime.withUnit(undefined, (unit) =>
      unit.identity.findUserIdByProviderCustomer("creem", customerId),
    );
    if (candidate.userId && customerUserId && candidate.userId !== customerUserId) {
      throw new Error("Creem customer ownership conflict");
    }
    return deps.commerce.resolveSubject({
      userId: candidate.userId ?? customerUserId,
      organizationId,
    });
  }

  async function rememberCustomer(userId: string | null, customerId: string | null) {
    if (!userId || !customerId) return;
    try {
      const result = await deps.commerce.runtime.withUnit(undefined, (unit) =>
        unit.identity.writeProviderCustomerIfAbsent(
          userId,
          "creem",
          customerId,
          deps.commerce.runtime.deps.clock.now(),
        ),
      );
      if (result === "conflict")
        deps.commerce.runtime.log(
          "warn",
          { userId },
          "User already has a different Creem customer id",
        );
    } catch (error) {
      deps.commerce.runtime.log(
        "warn",
        { err: safeUnknownError(error) },
        "Failed to store Creem customer id",
      );
    }
  }

  async function buildSyncInput(sub: CreemSubscription): Promise<SubscriptionSyncInput | null> {
    const productId =
      idOf(sub.product) ??
      (typeof sub.items?.[0]?.productId === "string" ? sub.items[0].productId : null);
    const metadata = asMetadata(sub.metadata);
    if (
      idOf(sub.product) &&
      sub.items?.[0]?.productId &&
      idOf(sub.product) !== sub.items[0].productId
    ) {
      throw new Error("Creem subscription product conflict");
    }
    const source = await deps.commerce.resolveSubscriptionSource({
      provider: "creem",
      subscriptionId: sub.id,
      externalId: productId,
      metadata,
      catalog,
    });
    const plan = source?.plan;
    if (!plan || !isSubscriptionPlan(plan)) return null;
    const observedSubject = await resolveCreemSubject(metadata, idOf(sub.customer));
    const boundSubject = source?.subject ?? null;
    if (
      boundSubject?.userId &&
      observedSubject.userId &&
      boundSubject.userId !== observedSubject.userId
    ) {
      throw new Error("Creem subscription customer ownership conflict");
    }
    const subject = boundSubject ?? observedSubject;
    const status = mapCreemSubscriptionStatus(sub.status ?? "");
    const canceledAt = asDate(sub.canceledAt);
    const ended = status === "canceled" || status === "expired";
    return {
      provider: "creem",
      providerSubscriptionId: sub.id,
      subject,
      planId: plan.id,
      providerCustomerId: idOf(sub.customer),
      providerPriceId: source.providerPriceId,
      status,
      interval: plan.interval ?? "month",
      currentPeriodStart: asDate(sub.currentPeriodStartDate),
      currentPeriodEnd: asDate(sub.currentPeriodEndDate),
      cancelAtPeriodEnd: sub.status === "scheduled_cancel",
      canceledAt,
      endedAt: ended ? (canceledAt ?? asDate(sub.currentPeriodEndDate)) : null,
      monthlyCredits: plan.monthlyCredits ?? 0,
      metadata,
    };
  }

  const api = {
    mapCreemSubscriptionStatus,
    resolveCreemPlan: (metadataPlanId: string | null, productId: string | null) =>
      resolveCreemPlan(catalog, metadataPlanId, productId),
    async fulfillCheckout(checkout: {
      id: string;
      status?: string;
      metadata?: Record<string, unknown> | null;
      product?: unknown;
      customer?: unknown;
      order?: {
        id?: string;
        type?: string;
        product?: string | null;
        amount?: number;
        amountPaid?: number | null;
        subTotal?: number | null;
        discountAmount?: number | null;
        taxAmount?: number | null;
        currency?: string;
        transaction?: string | null;
      } | null;
    }) {
      const order = checkout.order;
      if (!order?.id || order.type !== "onetime" || checkout.status !== "completed") return;
      const metadata = asMetadata(checkout.metadata);
      const subject = await resolveCreemSubject(metadata, idOf(checkout.customer));
      if (!subject.userId)
        throw new PermanentFulfillmentError(
          `Cannot resolve user for Creem checkout ${checkout.id} — check metadata.userId`,
        );
      const productId = idOf(checkout.product);
      if (productId && order.product && productId !== order.product)
        throw new Error("Creem checkout/order product conflict");
      const historical = !productId
        ? await deps.commerce.resolveHistoricalOrderSource({
            provider: "creem",
            orderId: order.id,
            metadata,
            catalog,
          })
        : null;
      const plan = productId
        ? resolveCreemPlan(
            catalog,
            typeof metadata.planId === "string" ? metadata.planId : null,
            productId,
          )
        : historical?.plan;
      if (!plan || plan.kind !== "credit_pack")
        throw new Error(`Cannot resolve credit pack plan for Creem checkout ${checkout.id}`);
      await deps.commerce.fulfillOneTimePurchase({
        provider: "creem",
        providerOrderId: order.id,
        providerPaymentId: order.transaction ?? null,
        subject,
        planId: plan.id,
        credits: getPlanCredits(plan),
        amountTotal: order.amountPaid ?? order.amount ?? 0,
        amountSubtotal: order.subTotal ?? null,
        amountDiscount: order.discountAmount ?? 0,
        amountTax: order.taxAmount ?? 0,
        currency: order.currency ?? "usd",
        metadata,
      });
      await rememberCustomer(subject.userId, idOf(checkout.customer));
    },
    async applyRefund(refund: {
      id?: string;
      status?: string;
      refundAmount?: number;
      transaction?: CreemTransaction | null;
      order?: unknown;
    }) {
      if (refund.status === "failed" || refund.status === "canceled") return;
      if (!refund.id) throw new Error("Creem refund has no stable refund id");
      const transaction = refund.transaction;
      if (!transaction?.id) throw new Error(`Creem refund ${refund.id} has no transaction`);
      const official =
        typeof transaction.refundedAmount === "number" && transaction.refundedAmount > 0
          ? transaction.refundedAmount
          : null;
      const locators = [
        ...new Set([idOf(refund.order), transaction.id].filter((id): id is string => !!id)),
      ];
      let result: Awaited<ReturnType<Commerce["applyRefund"]>> | null = null;
      for (const providerOrderId of locators) {
        result = await deps.commerce.applyRefund({
          provider: "creem",
          providerOrderId,
          providerPaymentId: transaction.id,
          amountRefunded: official ?? Math.abs(refund.refundAmount ?? 0),
          cumulative: official != null,
          refundId: refund.id,
        });
        if (result.orderFound) break;
      }
      if (!result?.orderFound)
        throw new Error(
          `Creem refund ${refund.id}: no local order for ${locators.join(" / ")} — retrying until the order lands`,
        );
      if (result.fullRefundOfSubscription && result.providerSubscriptionId) {
        await deps.commerce.runtime.deps.cancelSubscription?.(
          "creem",
          result.providerSubscriptionId,
          "Fully refunded",
        );
      }
      return result;
    },
    async fulfillSubscriptionPaid(sub: CreemSubscription) {
      let current = sub;
      let tx = current.lastTransaction ?? null;
      if (!tx) {
        if (!deps.getSubscription)
          throw new Error(
            `Creem subscription.paid ${sub.id} requires getSubscription when lastTransaction is absent`,
          );
        const fresh = await deps.getSubscription(sub.id);
        tx = fresh.lastTransaction ?? null;
        current = {
          ...fresh,
          metadata: { ...asMetadata(sub.metadata), ...asMetadata(fresh.metadata) },
        };
      }
      const built = await buildSyncInput(current);
      if (!built)
        throw new Error(
          `Cannot fulfill Creem subscription payment for ${sub.id}: no plan resolved`,
        );
      if (!tx?.id || !tx.currency)
        throw new Error(
          `Cannot fulfill Creem subscription payment for ${sub.id}: no transaction on payload`,
        );
      if (tx.status !== "paid") {
        await deps.commerce.syncSubscription(built);
        return;
      }
      const prior = await deps.commerce.runtime.withUnit(undefined, (unit) =>
        unit.subscriptions.countOtherSubscriptionOrders("creem", current.id, tx.id!),
      );
      const amountTotal = tx.amountPaid ?? tx.amount ?? 0;
      const result = await deps.commerce.fulfillSubscriptionPayment({
        subscription: built,
        orderType: prior > 0 ? "subscription_renewal" : "subscription_initial",
        providerOrderId: tx.id,
        providerPaymentId: tx.id,
        amountTotal,
        amountSubtotal: tx.amount ?? null,
        amountDiscount: tx.discountAmount ?? 0,
        amountTax: tx.taxAmount ?? 0,
        currency: tx.currency,
        periodStart: epochToDate(tx.periodStart) ?? asDate(current.currentPeriodStartDate),
        metadata: asMetadata(current.metadata),
      });
      if (result.duplicate) {
        if (!deps.refundTransaction)
          throw new Error(
            "Creem duplicate settlement requires an injected refundTransaction port; refusing to acknowledge an unsettled duplicate",
          );
        await deps.commerce.settleDuplicateSubscription({
          provider: "creem",
          providerSubscriptionId: current.id,
          providerOrderId: tx.id,
          winner: result.duplicate,
          amountTotal,
          currency: tx.currency,
          userId: built.subject.userId,
          refund: async () => {
            try {
              await deps.refundTransaction!(tx.id!);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              if (/already.*refund|fully refunded/i.test(message)) return;
              if (/not found|does not exist|\b404\b/i.test(message)) {
                throw new PermanentFulfillmentError(
                  `Creem refuses to refund transaction ${tx.id} (${message}) — refund it manually in the Creem dashboard`,
                );
              }
              throw error;
            }
          },
        });
        return;
      }
      await rememberCustomer(built.subject.userId, built.providerCustomerId ?? null);
    },
    webhook() {
      return async (rawBody: string, headers: Headers) => {
        try {
          await sdk.verifyWebhookSignature(rawBody, headers, deps.webhookSecret!);
        } catch (error) {
          deps.commerce.runtime.log(
            "warn",
            { err: safeUnknownError(error) },
            "Creem webhook signature verification failed",
          );
          return { status: 400, body: { error: "Signature verification failed." } };
        }
        let envelope: CreemWebhookEnvelope;
        try {
          envelope = sdk.parseWebhookEvent(rawBody);
        } catch {
          return { status: 400, body: { error: "Invalid webhook payload." } };
        }
        const eventType = envelope.type;
        if (!HANDLED_EVENTS.has(eventType)) return { status: 200, body: { received: true } };
        let entity: CreemWebhookEntity;
        try {
          entity = sdk.parseWebhookEventEntity(rawBody);
        } catch (error) {
          deps.commerce.runtime.log(
            "error",
            { eventType, err: safeUnknownError(error) },
            "Creem webhook schema validation failed",
          );
          if (MONEY_EVENTS.has(eventType)) await notifyFromEnvelope(envelope, error);
          return { status: 500, body: { error: "Failed to process Creem webhook." } };
        }
        try {
          const object = asRecord(entity.object);
          if (!object) throw new Error(`Creem ${entity.eventType} payload has no object`);
          if (entity.eventType === "checkout.completed") {
            await api.fulfillCheckout(
              object as unknown as Parameters<typeof api.fulfillCheckout>[0],
            );
          } else if (entity.eventType === "refund.created") {
            await api.applyRefund(object as unknown as Parameters<typeof api.applyRefund>[0]);
          } else if (entity.eventType === "dispute.created") {
            const metadata = asMetadata(
              asRecord(object.subscription)?.metadata ?? asRecord(object.checkout)?.metadata,
            );
            await deps.commerce.runtime.deps.notifier?.onDispute?.({
              provider: "creem",
              disputeId: object.id ?? null,
              providerPaymentId: idOf(asRecord(object.transaction)?.id) ?? idOf(object.transaction),
              providerOrderId: idOf(object.order),
              amount: object.amount ?? null,
              currency: object.currency ?? null,
              userId: typeof metadata.userId === "string" ? metadata.userId : null,
              planId: typeof metadata.planId === "string" ? metadata.planId : null,
            });
          } else if (
            entity.eventType === "subscription.canceled" ||
            entity.eventType === "subscription.expired"
          ) {
            const sub = object as unknown as CreemSubscription;
            if (!sub.id) throw new Error(`Creem ${entity.eventType} has no subscription id`);
            const built = await buildSyncInput(sub);
            if (built) {
              await deps.commerce.syncSubscription(built);
              await rememberCustomer(built.subject.userId, built.providerCustomerId ?? null);
            }
            const mapped = mapCreemSubscriptionStatus(sub.status ?? "");
            const canceledAt = asDate(sub.canceledAt);
            await deps.commerce.handleSubscriptionEnded("creem", sub.id, {
              status: mapped === "active" || mapped === "trialing" ? "canceled" : mapped,
              canceledAt,
              endedAt:
                canceledAt ??
                asDate(sub.currentPeriodEndDate) ??
                deps.commerce.runtime.deps.clock.now(),
            });
          } else if (entity.eventType === "subscription.paid") {
            await api.fulfillSubscriptionPaid(object as unknown as CreemSubscription);
          } else {
            const sub = object as unknown as CreemSubscription;
            const built = await buildSyncInput(sub);
            if (!built)
              throw new Error(`Creem ${entity.eventType} did not resolve to a subscription plan`);
            await deps.commerce.syncSubscription(built);
            await rememberCustomer(built.subject.userId, built.providerCustomerId ?? null);
          }
          return { status: 200, body: { received: true } };
        } catch (error) {
          deps.commerce.runtime.log(
            "error",
            { eventType: entity.eventType, err: safeUnknownError(error) },
            "Creem webhook handler failed",
          );
          if (MONEY_EVENTS.has(entity.eventType)) await notifyFromEnvelope(envelope, error);
          if (error instanceof PermanentFulfillmentError)
            return { status: 200, body: { received: true, permanentError: true } };
          return { status: 500, body: { error: "Failed to process Creem webhook." } };
        }
      };
    },
  };

  async function notifyFromEnvelope(envelope: CreemWebhookEnvelope, error: unknown) {
    const data = asRecord(envelope.data);
    const metadata = asMetadata(data?.metadata);
    await notifyCreditGrantFailed(deps.commerce.runtime, {
      userId: typeof metadata.userId === "string" ? metadata.userId : "unknown",
      orderId: typeof data?.id === "string" ? data.id : "unknown",
      planId: typeof metadata.planId === "string" ? metadata.planId : "unknown",
      error,
    });
  }

  return api;
}
