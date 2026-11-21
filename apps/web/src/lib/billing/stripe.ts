/**
 * Stripe adapter wrapper.
 *
 * SDK objects stay at this edge. Financial decisions run in the commerce
 * provider bound to the selected app instance. Radar early fraud remains here
 * because it refunds and sends app mail outside the package webhook.
 */

import type Stripe from "stripe";
import {
  createStripeProvider,
  mapStripeSubscriptionStatus,
  type StripeCheckoutSession,
  type StripeCustomer,
  type StripeInvoice,
  type StripeSubscription,
  type StripeWebhookClient,
} from "@sunpcm/niu-commerce/providers/stripe";
import { getAppCommerce, type AppCommerce } from "@/composition/commerce";
import { getStripe } from "@/lib/stripe";
import { cancelProviderSubscription } from "./cancel";
import { notifyFraudRefundUser, notifyFraudWarningAdmin } from "./notify";
import {
  defaultSourceIdentityCatalog,
  resolvePlanBySource,
  type SourceIdentityCatalog,
} from "@/lib/pricing/source-identity";

export { mapStripeSubscriptionStatus };

export interface StripeLineItemsTransport {
  listLineItems(sessionId: string): Promise<{
    data: { price: string | { id: string } | null; quantity: number | null }[];
    has_more?: boolean;
  }>;
}

export interface StripeCheckoutDeps {
  catalog?: SourceIdentityCatalog;
  lineItems?: StripeLineItemsTransport;
  getSubscription?: (id: string) => Promise<Stripe.Subscription>;
  getInvoice?: (id: string) => Promise<Stripe.Invoice>;
  getCustomer?: (id: string) => Promise<Stripe.Customer | Stripe.DeletedCustomer | null>;
  getSession?: (id: string) => Promise<Stripe.Checkout.Session>;
  client?: Pick<Stripe, "webhooks"> &
    Partial<Pick<Stripe, "checkout" | "subscriptions" | "invoices" | "customers">>;
  webhookSecret?: string;
}

export interface StripeCheckoutFulfillmentResult {
  paid: boolean;
  failed: boolean;
  userId: string | null;
  planId: string | null;
}

interface AdaptedStripeClient extends StripeWebhookClient {
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

function adaptStripeClient(client: StripeCheckoutDeps["client"]): AdaptedStripeClient | undefined {
  if (!client) return undefined;
  const adapted: AdaptedStripeClient = {
    webhooks: {
      constructEvent(payload, signature, secret) {
        return client.webhooks.constructEvent(payload, signature, secret);
      },
    },
  };

  const sessions = client.checkout?.sessions;
  if (sessions?.listLineItems) {
    adapted.checkout = {
      sessions: {
        listLineItems: (id, params) => sessions.listLineItems(id, params),
      },
    };
  }

  const subscriptions = client.subscriptions;
  if (subscriptions?.retrieve) {
    adapted.subscriptions = {
      retrieve: (id) => subscriptions.retrieve(id),
    };
  }

  const invoices = client.invoices;
  if (invoices?.retrieve) {
    adapted.invoices = {
      retrieve: (id, params) => invoices.retrieve(id, params),
    };
  }

  const customers = client.customers;
  if (customers?.retrieve) {
    adapted.customers = {
      retrieve: async (id) => {
        const customer = await customers.retrieve(id);
        return {
          id: customer.id,
          deleted: customer.deleted === true,
          metadata: "metadata" in customer ? { userId: customer.metadata?.userId ?? null } : null,
        };
      },
    };
  }

  return adapted;
}

export function createStripeBilling(app: AppCommerce) {
  async function provider(deps: StripeCheckoutDeps = {}) {
    return createStripeProvider({
      commerce: app.commerce,
      catalog: deps.catalog,
      webhookSecret: deps.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET,
      client: adaptStripeClient(deps.client),
      apiKey: process.env.STRIPE_SECRET_KEY,
      lineItems: deps.lineItems ? (id) => deps.lineItems!.listLineItems(id) : undefined,
      getSubscription: deps.getSubscription as
        | ((id: string) => Promise<StripeSubscription>)
        | undefined,
      getInvoice: deps.getInvoice as ((id: string) => Promise<StripeInvoice>) | undefined,
      getCustomer: deps.getCustomer as ((id: string) => Promise<StripeCustomer | null>) | undefined,
      refundPaymentIntent: async (paymentIntentId, idempotencyKey) => {
        await getStripe().refunds.create({ payment_intent: paymentIntentId }, { idempotencyKey });
      },
    });
  }

  function resolvePlan(
    params: { metadata?: Stripe.Metadata | null; priceId?: string | null },
    catalog?: SourceIdentityCatalog,
  ) {
    return app.commerce.resolvePlanBySource(
      {
        provider: "stripe",
        metadataPlanId: params.metadata?.planId ?? null,
        externalId: params.priceId ?? null,
      },
      catalog ?? app.commerce.runtime.catalog,
    );
  }

  async function resolveStripeUserId(params: {
    metadata?: Stripe.Metadata | null;
    customerId?: string | null;
  }) {
    const subject = await app.commerce.resolveSubject({
      userId: params.metadata?.userId ?? null,
      organizationId: params.metadata?.organizationId ?? null,
    });
    if (!params.customerId) return subject.userId;
    const customerUserId = await app.commerce.runtime.withUnit(undefined, (unit) =>
      unit.identity.findUserIdByProviderCustomer("stripe", params.customerId!),
    );
    if (subject.userId && customerUserId && subject.userId !== customerUserId) {
      throw new Error("Stripe checkout customer ownership conflict");
    }
    return subject.userId ?? customerUserId;
  }

  async function fulfillCheckoutSession(
    session: Stripe.Checkout.Session,
    deps: StripeCheckoutDeps = {},
  ) {
    await (await provider(deps)).fulfillCheckout(session as never);
  }

  async function fulfillCheckoutSessionById(
    sessionId: string,
    expectedUserId: string,
    deps: StripeCheckoutDeps = {},
  ): Promise<StripeCheckoutFulfillmentResult> {
    const session = await (deps.getSession
      ? deps.getSession(sessionId)
      : getStripe().checkout.sessions.retrieve(sessionId, { expand: ["line_items"] }));
    const priceId = session.line_items?.data?.[0]?.price
      ? typeof session.line_items.data[0].price === "string"
        ? session.line_items.data[0].price
        : (session.line_items.data[0].price?.id ?? null)
      : null;
    const plan = resolvePlan({ metadata: session.metadata, priceId }, deps.catalog);
    const paid =
      session.payment_status === "paid" || session.payment_status === "no_payment_required";
    const planId = plan?.id ?? null;
    const customerId =
      typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
    const userId = await resolveStripeUserId({
      metadata: session.metadata,
      customerId,
    });
    if (!userId || userId !== expectedUserId) {
      return { paid, failed: true, userId, planId };
    }
    await fulfillCheckoutSession(session, deps);
    return { paid, failed: false, userId, planId };
  }

  async function syncStripeSubscription(
    stripeSub: Stripe.Subscription,
    deps: StripeCheckoutDeps = {},
  ) {
    const stripe = await provider({
      ...deps,
      webhookSecret: deps.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? "unused-sync",
    });
    await stripe.syncSubscription(stripeSub as never);
  }

  async function handleSubscriptionDeleted(
    stripeSub: Stripe.Subscription,
    deps: StripeCheckoutDeps = {},
  ) {
    await syncStripeSubscription(stripeSub, deps);
    await app.commerce.handleSubscriptionEnded("stripe", stripeSub.id, {
      status: mapStripeSubscriptionStatus(stripeSub.status),
      canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null,
      endedAt: stripeSub.ended_at ? new Date(stripeSub.ended_at * 1000) : null,
    });
  }

  async function handleEarlyFraudWarning(warning: Stripe.Radar.EarlyFraudWarning): Promise<void> {
    const stripe = getStripe();
    const chargeId = typeof warning.charge === "string" ? warning.charge : warning.charge.id;
    const actions = (process.env.STRIPE_RADAR_EARLY_FRAUD_WARNING_TYPE ?? "")
      .toLowerCase()
      .split(",")
      .map((item) => item.trim());
    const shouldRefund = actions.includes("refund");
    const shouldEmail = actions.includes("email");
    if (!shouldRefund && !shouldEmail) return;
    const charge = await stripe.charges.retrieve(chargeId);
    const actionsTaken: string[] = [];
    if (shouldRefund && !charge.refunded) {
      await stripe.refunds.create({ charge: chargeId, reason: "fraudulent" });
      actionsTaken.push("Automatic refund initiated");
      const paymentIntentId =
        typeof charge.payment_intent === "string" ? charge.payment_intent : null;
      if (paymentIntentId) {
        const order = await app.commerce.runtime.withUnit(undefined, (unit) =>
          unit.orders.findFirstByProviderPayment("stripe", paymentIntentId),
        );
        if (order?.providerSubscriptionId) {
          const cancelled = await cancelProviderSubscription(
            "stripe",
            order.providerSubscriptionId,
            "Fraudulent payment (Radar early fraud warning)",
          );
          if (cancelled)
            actionsTaken.push(`Subscription ${order.providerSubscriptionId} cancelled`);
        }
      }
      await notifyFraudRefundUser({ charge });
    }
    if (shouldEmail) {
      actionsTaken.push("Fraud warning email sent to administrators");
      await notifyFraudWarningAdmin({ warningId: warning.id, charge, actionsTaken });
    }
  }

  return {
    resolveStripeUserId,
    resolvePlan,
    fulfillCheckoutSession,
    fulfillCheckoutSessionById,
    syncStripeSubscription,
    fulfillInvoicePaid: async (invoice: Stripe.Invoice, deps: StripeCheckoutDeps = {}) => {
      await (await provider(deps)).fulfillInvoice(invoice as never);
    },
    handleSubscriptionDeleted,
    applyRefundForCharge: async (charge: Stripe.Charge, deps: StripeCheckoutDeps = {}) => {
      await (await provider(deps)).applyChargeRefund(charge as never);
    },
    handleInvoicePaymentFailed: async (invoice: Stripe.Invoice, deps: StripeCheckoutDeps = {}) => {
      await (await provider(deps)).fulfillInvoice({ ...invoice, status: "open" } as never);
    },
    handleEarlyFraudWarning,
  };
}

export type StripeBilling = ReturnType<typeof createStripeBilling>;

async function defaultBilling(): Promise<StripeBilling> {
  return createStripeBilling(await getAppCommerce());
}

export function resolveStripeUserId(params: {
  metadata?: Stripe.Metadata | null;
  customerId?: string | null;
}) {
  return defaultBilling().then((billing) => billing.resolveStripeUserId(params));
}

export function resolvePlan(
  params: { metadata?: Stripe.Metadata | null; priceId?: string | null },
  catalog: SourceIdentityCatalog = defaultSourceIdentityCatalog,
) {
  return resolvePlanBySource(
    {
      provider: "stripe",
      metadataPlanId: params.metadata?.planId ?? null,
      externalId: params.priceId ?? null,
    },
    catalog,
  );
}

export function fulfillCheckoutSession(
  session: Stripe.Checkout.Session,
  deps: StripeCheckoutDeps = {},
) {
  return defaultBilling().then((billing) => billing.fulfillCheckoutSession(session, deps));
}

export function fulfillCheckoutSessionById(
  sessionId: string,
  expectedUserId: string,
  deps: StripeCheckoutDeps = {},
) {
  return defaultBilling().then((billing) =>
    billing.fulfillCheckoutSessionById(sessionId, expectedUserId, deps),
  );
}

export function syncStripeSubscription(
  stripeSub: Stripe.Subscription,
  deps: StripeCheckoutDeps = {},
) {
  return defaultBilling().then((billing) => billing.syncStripeSubscription(stripeSub, deps));
}

export function fulfillInvoicePaid(invoice: Stripe.Invoice, deps: StripeCheckoutDeps = {}) {
  return defaultBilling().then((billing) => billing.fulfillInvoicePaid(invoice, deps));
}

export function handleSubscriptionDeleted(
  stripeSub: Stripe.Subscription,
  deps: StripeCheckoutDeps = {},
) {
  return defaultBilling().then((billing) => billing.handleSubscriptionDeleted(stripeSub, deps));
}

export function applyRefundForCharge(charge: Stripe.Charge, deps: StripeCheckoutDeps = {}) {
  return defaultBilling().then((billing) => billing.applyRefundForCharge(charge, deps));
}

export function handleInvoicePaymentFailed(invoice: Stripe.Invoice, deps: StripeCheckoutDeps = {}) {
  return defaultBilling().then((billing) => billing.handleInvoicePaymentFailed(invoice, deps));
}

export function handleEarlyFraudWarning(warning: Stripe.Radar.EarlyFraudWarning): Promise<void> {
  return defaultBilling().then((billing) => billing.handleEarlyFraudWarning(warning));
}
