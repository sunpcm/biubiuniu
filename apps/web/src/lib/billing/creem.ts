/**
 * [INPUT]: Depends on @/lib/creem/client for retrieveCreemCheckoutSession/
 *          retrieveCreemSubscription/refundCreemTransaction,
 *          @/lib/creem/types for the entity types (official SDK camelCase
 *          shapes), @/config/pricing for plan resolution (getPlanById/
 *          findPlanByProviderPriceId/isSubscriptionPlan/getPlanCredits),
 *          ./fulfillment for the provider-agnostic core, ./cancel for the
 *          provider-side cancel funnel, ./duplicate for duplicate-subscription
 *          settlement (injected with a Creem refund closure),
 *          @/lib/db and schema for the orders/user tables, @/lib/logger for
 *          sanitized diagnostics
 * [OUTPUT]: Exports mapCreemSubscriptionStatus, resolveCreemSubject,
 *           fulfillCreemCheckout, fulfillCreemCheckoutById,
 *           fulfillCreemSubscriptionPaid, syncCreemSubscription,
 *           handleCreemSubscriptionEnded, applyCreemRefund,
 *           handleCreemDispute, reconcileCreemSubscription
 * [POS]: The Creem adapter of lib/billing — the only fulfillment file where
 *        Creem payload types appear: it translates the Creem objects pulled
 *        from webhooks / the success page / reconciliation into ./types inputs
 *        and calls the core; Creem amounts are already integer cents and are
 *        always passed through untouched, never converted;
 *        idempotency keys: one-time = creem order id, subscription = creem
 *        transaction id; the sole writer of user.creemCustomerId (pinned on
 *        first sight); Creem-side cancels for full refunds / superseded
 *        subscriptions go through ./cancel, duplicate refunds through
 *        POST /v1/refunds (full amount only) — the core never calls back into
 *        a provider API; operator notifications use the owning AppCommerce
 *        instance
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { isSubscriptionPlan, type PricingPlan, type SubscriptionPlan } from "@/config/pricing";
import {
  refundCreemTransaction,
  retrieveCreemCheckoutSession,
  retrieveCreemSubscription,
} from "@/lib/creem/client";
import type {
  CreemCheckout,
  CreemDispute,
  CreemRefund,
  CreemSubscription,
} from "@/lib/creem/types";
import { getLogger } from "@/lib/logger";
import {
  defaultSourceIdentityCatalog,
  resolvePlanBySource,
  type SourceIdentityCatalog,
} from "@/lib/pricing/source-identity";
import { createCreemProvider } from "@sunpcm/niu-commerce/providers/creem";
import { getAppCommerce, type AppCommerce } from "@/composition/commerce";
import { createFulfillmentBilling } from "./fulfillment";
import { createSourceBindingBilling } from "./source-binding";
import type { BillingSubject, CanonicalSubscriptionStatus, SubscriptionSyncInput } from "./types";

const logger = getLogger("billing.creem");

// ============================================================================
// Status mapping — Creem's vocabulary is close to canonical. The one policy
// call: 'scheduled_cancel' means "still entitled until period end", so it
// normalizes to 'active' (cancelAtPeriodEnd carries the scheduling fact).
// Anything unknown degrades to 'incomplete' — never entitled by accident.
// ============================================================================

export function mapCreemSubscriptionStatus(creemStatus: string): CanonicalSubscriptionStatus {
  switch (creemStatus) {
    case "active":
    case "trialing":
    case "past_due":
    case "unpaid":
    case "canceled":
    case "expired":
    case "paused":
      return creemStatus;
    case "scheduled_cancel":
      return "active";
    default:
      return "incomplete";
  }
}

// ----------------------------------------------------------------------------
// Payload helpers — the SDK inlines related objects on webhooks but may ship
// bare ids on API reads; every accessor below tolerates both shapes.
// ----------------------------------------------------------------------------

function toDate(value: Date | null | undefined): Date | null {
  if (!value) return null;
  return Number.isNaN(value.getTime()) ? null : value;
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : (value.id ?? null);
}

function objectOf<T extends { id: string }>(value: T | string | null | undefined): T | null {
  return value && typeof value === "object" ? value : null;
}

/** Source-identity resolution: the Creem product id is authoritative when present (metadata is a cross-check that must agree); metadata alone is only honored for legacy events that carry no product id. */
export function resolveCreemPlan(
  params: {
    metadata?: Record<string, unknown> | null;
    productId?: string | null;
  },
  catalog: SourceIdentityCatalog = defaultSourceIdentityCatalog,
): PricingPlan | null {
  return resolvePlanBySource(
    {
      provider: "creem",
      metadataPlanId: typeof params.metadata?.planId === "string" ? params.metadata.planId : null,
      externalId: params.productId ?? null,
    },
    catalog,
  );
}

export interface CreemAdapterDeps {
  catalog?: SourceIdentityCatalog;
  getSubscription?: typeof retrieveCreemSubscription;
  getCheckout?: typeof retrieveCreemCheckoutSession;
  webhookSecret?: string;
  webhooks?: {
    verifyWebhookSignature(payload: string, headers: Headers, secret: string): Promise<void>;
    parseWebhookEvent(payload: string): { type: string; data?: unknown; id?: string };
    parseWebhookEventEntity(payload: string): { eventType: string; object: unknown };
  };
}

export function createCreemBilling(app: AppCommerce) {
  const fulfillment = createFulfillmentBilling(app);
  const sourceBinding = createSourceBindingBilling(app);
  const sourceCatalog = (deps: CreemAdapterDeps): SourceIdentityCatalog =>
    deps.catalog ?? (app.commerce.runtime.catalog as SourceIdentityCatalog);

  async function resolveCreemSubject(
    metadata: Record<string, unknown> | null | undefined,
  ): Promise<BillingSubject> {
    return fulfillment.resolveSubject({
      userId: typeof metadata?.userId === "string" ? metadata.userId : null,
      organizationId: typeof metadata?.organizationId === "string" ? metadata.organizationId : null,
    });
  }

  async function resolveCreemUserId(params: {
    metadata: Record<string, unknown> | null | undefined;
    customerId: string | null;
  }): Promise<string | null> {
    const candidateUserId =
      typeof params.metadata?.userId === "string" ? params.metadata.userId : null;
    const [metadataUserId, customerUserId] = await Promise.all([
      fulfillment.resolveValidUserId(candidateUserId),
      params.customerId
        ? app.commerce.runtime.withUnit(undefined, (unit) =>
            unit.identity.findUserIdByProviderCustomer("creem", params.customerId!),
          )
        : Promise.resolve(null),
    ]);
    if (metadataUserId && customerUserId && metadataUserId !== customerUserId) {
      throw new Error("Creem checkout customer ownership conflict");
    }
    return metadataUserId ?? customerUserId;
  }

  async function rememberCreemCustomerId(
    userId: string | null,
    customerId: string | null,
  ): Promise<void> {
    if (!userId || !customerId) return;
    try {
      const written = await app.commerce.runtime.withUnit(undefined, (unit) =>
        unit.identity.writeProviderCustomerIfAbsent(
          userId,
          "creem",
          customerId,
          app.commerce.runtime.deps.clock.now(),
        ),
      );
      if (written === "conflict") {
        logger.warn({ userId }, "User already has a different Creem customer id");
      }
    } catch (error) {
      logger.warn(
        { userId, creemCustomerId: customerId, err: error },
        "Failed to store Creem customer id",
      );
    }
  }

  async function creemProvider(deps: CreemAdapterDeps = {}) {
    const { parseWebhookEvent, parseWebhookEventEntity, verifyWebhookSignature } =
      await import("creem/webhooks");
    return createCreemProvider({
      commerce: app.commerce,
      catalog: deps.catalog,
      webhookSecret: deps.webhookSecret ?? process.env.CREEM_WEBHOOK_SECRET ?? "direct-creem-call",
      webhooks: deps.webhooks ?? {
        verifyWebhookSignature,
        parseWebhookEvent,
        parseWebhookEventEntity,
      },
      getSubscription: deps.getSubscription,
      refundTransaction: async (transactionId) => {
        await refundCreemTransaction(transactionId);
      },
    });
  }

  async function fulfillCreemCheckout(
    checkout: CreemCheckout,
    deps: CreemAdapterDeps = {},
  ): Promise<void> {
    const provider = await creemProvider(deps);
    await provider.fulfillCheckout(checkout);
  }

  async function syncCreemSubscription(
    sub: CreemSubscription,
    deps: CreemAdapterDeps = {},
  ): Promise<{
    subject: BillingSubject;
    plan: SubscriptionPlan;
  } | null> {
    const built = await buildCreemSyncInput(sub, deps);
    if (!built) return null;
    await fulfillment.syncSubscription(built.input);
    await rememberCreemCustomerId(
      built.input.subject.userId,
      built.input.providerCustomerId ?? null,
    );
    return { subject: built.input.subject, plan: built.plan };
  }

  async function fulfillCreemCheckoutById(
    checkoutId: string,
    expectedUserId: string,
    deps: CreemAdapterDeps = {},
  ): Promise<{
    paid: boolean;
    planId: string | null;
    userId: string | null;
  }> {
    const checkout = await (deps.getCheckout ?? retrieveCreemCheckoutSession)(checkoutId);
    const paid = checkout.status === "completed";
    const metadata = checkout.metadata ?? {};
    const customerId = idOf(checkout.customer);
    const userId = await resolveCreemUserId({ metadata, customerId });
    const productId = idOf(checkout.product);
    const plan = productId ? resolveCreemPlan({ metadata, productId }, sourceCatalog(deps)) : null;
    const planId = plan?.id ?? null;
    const visibleUserId = userId === expectedUserId ? userId : null;
    if (!paid || userId !== expectedUserId) {
      return { paid, planId, userId: visibleUserId };
    }

    const organizationId = await fulfillment.resolveValidOrganizationId(
      typeof metadata.organizationId === "string" ? metadata.organizationId : null,
    );
    const canonicalMetadata: Record<string, unknown> = { ...metadata, userId };
    if (organizationId) canonicalMetadata.organizationId = organizationId;
    else delete canonicalMetadata.organizationId;

    const subscription = objectOf(checkout.subscription);
    if (checkout.order?.type === "onetime") {
      await fulfillCreemCheckout({ ...checkout, metadata: canonicalMetadata }, deps);
    } else if (subscription) {
      await syncCreemSubscription(
        {
          ...subscription,
          metadata: { ...(subscription.metadata ?? {}), ...canonicalMetadata },
        },
        deps,
      );
    }
    return { paid, planId, userId };
  }

  async function buildCreemSyncInput(
    sub: CreemSubscription,
    deps: CreemAdapterDeps = {},
  ): Promise<{
    input: SubscriptionSyncInput;
    plan: SubscriptionPlan;
  } | null> {
    const productId = idOf(sub.product) ?? sub.items?.[0]?.productId ?? null;
    const metadata = sub.metadata ?? {};
    if (
      idOf(sub.product) &&
      sub.items?.[0]?.productId &&
      idOf(sub.product) !== sub.items[0].productId
    ) {
      throw new Error("Creem subscription product conflict");
    }
    const catalog = sourceCatalog(deps);
    const source = await sourceBinding.resolveSubscriptionSource({
      provider: "creem",
      subscriptionId: sub.id,
      externalId: productId,
      metadata,
      catalog,
    });
    const plan = source ? catalog.getPlanById(source.plan.id) : undefined;
    if (!plan || !isSubscriptionPlan(plan)) {
      logger.error(
        { providerProductId: productId, providerSubscriptionId: sub.id },
        "No Creem subscription plan matches the product",
      );
      return null;
    }
    const subject = source?.subject ?? (await resolveCreemSubject(metadata));
    const status = mapCreemSubscriptionStatus(sub.status);
    const canceledAt = toDate(sub.canceledAt);
    const isEnded = status === "canceled" || status === "expired";
    return {
      plan,
      input: {
        provider: "creem",
        providerSubscriptionId: sub.id,
        subject,
        planId: plan.id,
        providerCustomerId: idOf(sub.customer),
        providerPriceId: source?.providerPriceId,
        status,
        interval: plan.interval,
        currentPeriodStart: toDate(sub.currentPeriodStartDate),
        currentPeriodEnd: toDate(sub.currentPeriodEndDate),
        cancelAtPeriodEnd: sub.status === "scheduled_cancel",
        canceledAt,
        endedAt: isEnded ? (canceledAt ?? toDate(sub.currentPeriodEndDate)) : null,
        monthlyCredits: plan.monthlyCredits,
      },
    };
  }

  async function fulfillCreemSubscriptionPaid(
    sub: CreemSubscription,
    deps: CreemAdapterDeps = {},
  ): Promise<void> {
    const provider = await creemProvider(deps);
    await provider.fulfillSubscriptionPaid(sub);
  }

  async function handleCreemSubscriptionEnded(
    sub: CreemSubscription,
    deps: CreemAdapterDeps = {},
  ): Promise<void> {
    await syncCreemSubscription(sub, deps);
    const mapped = mapCreemSubscriptionStatus(sub.status);
    const canceledAt = toDate(sub.canceledAt);
    await fulfillment.handleSubscriptionEnded("creem", sub.id, {
      status: mapped === "active" || mapped === "trialing" ? "canceled" : mapped,
      canceledAt,
      endedAt: canceledAt ?? toDate(sub.currentPeriodEndDate) ?? new Date(),
    });
  }

  async function reconcileCreemSubscription(
    providerSubscriptionId: string,
    deps: CreemAdapterDeps = {},
  ): Promise<"ended" | "fulfilled" | "synced"> {
    const sub = await (deps.getSubscription ?? retrieveCreemSubscription)(providerSubscriptionId);
    if (sub.status === "canceled") {
      await handleCreemSubscriptionEnded(sub, deps);
      return "ended";
    }
    if (sub.lastTransaction?.status === "paid") {
      await fulfillCreemSubscriptionPaid(sub, deps);
      return "fulfilled";
    }
    await syncCreemSubscription(sub, deps);
    return "synced";
  }

  async function applyCreemRefund(refund: CreemRefund, deps: CreemAdapterDeps = {}): Promise<void> {
    const provider = await creemProvider(deps);
    await provider.applyRefund(refund);
  }

  async function handleCreemDispute(dispute: CreemDispute): Promise<void> {
    const subscription = objectOf(dispute.subscription);
    const checkout = objectOf(dispute.checkout);
    const metadata = subscription?.metadata ?? checkout?.metadata ?? {};
    await app.commerce.runtime.deps.notifier?.onDispute?.({
      provider: "creem",
      disputeId: dispute.id,
      providerPaymentId: dispute.transaction.id,
      providerOrderId: idOf(dispute.order),
      amount: dispute.amount,
      currency: dispute.currency,
      userId: typeof metadata.userId === "string" ? metadata.userId : null,
      planId: typeof metadata.planId === "string" ? metadata.planId : null,
    });
  }

  return {
    resolveCreemSubject,
    resolveCreemUserId,
    creemProvider,
    fulfillCreemCheckout,
    fulfillCreemCheckoutById,
    syncCreemSubscription,
    fulfillCreemSubscriptionPaid,
    handleCreemSubscriptionEnded,
    reconcileCreemSubscription,
    applyCreemRefund,
    handleCreemDispute,
  };
}

export type CreemBilling = ReturnType<typeof createCreemBilling>;

async function defaultBilling(): Promise<CreemBilling> {
  return createCreemBilling(await getAppCommerce());
}

export function resolveCreemSubject(
  metadata: Record<string, unknown> | null | undefined,
): Promise<BillingSubject> {
  return defaultBilling().then((billing) => billing.resolveCreemSubject(metadata));
}

export function creemProvider(deps: Parameters<CreemBilling["creemProvider"]>[0] = {}) {
  return defaultBilling().then((billing) => billing.creemProvider(deps));
}

export function fulfillCreemCheckout(
  checkout: CreemCheckout,
  deps: CreemAdapterDeps = {},
): Promise<void> {
  return defaultBilling().then((billing) => billing.fulfillCreemCheckout(checkout, deps));
}

export function fulfillCreemCheckoutById(
  checkoutId: string,
  expectedUserId: string,
  deps: CreemAdapterDeps = {},
) {
  return defaultBilling().then((billing) =>
    billing.fulfillCreemCheckoutById(checkoutId, expectedUserId, deps),
  );
}

export function syncCreemSubscription(sub: CreemSubscription, deps: CreemAdapterDeps = {}) {
  return defaultBilling().then((billing) => billing.syncCreemSubscription(sub, deps));
}

export function fulfillCreemSubscriptionPaid(
  sub: CreemSubscription,
  deps: CreemAdapterDeps = {},
): Promise<void> {
  return defaultBilling().then((billing) => billing.fulfillCreemSubscriptionPaid(sub, deps));
}

export function handleCreemSubscriptionEnded(
  sub: CreemSubscription,
  deps: CreemAdapterDeps = {},
): Promise<void> {
  return defaultBilling().then((billing) => billing.handleCreemSubscriptionEnded(sub, deps));
}

export function reconcileCreemSubscription(
  providerSubscriptionId: string,
  deps: CreemAdapterDeps = {},
) {
  return defaultBilling().then((billing) =>
    billing.reconcileCreemSubscription(providerSubscriptionId, deps),
  );
}

export function applyCreemRefund(refund: CreemRefund, deps: CreemAdapterDeps = {}): Promise<void> {
  return defaultBilling().then((billing) => billing.applyCreemRefund(refund, deps));
}

export function handleCreemDispute(dispute: CreemDispute): Promise<void> {
  return defaultBilling().then((billing) => billing.handleCreemDispute(dispute));
}
