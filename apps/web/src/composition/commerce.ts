/**
 * Commerce composition.
 *
 * Production and tests share `createAppCommerce`. It binds one catalog, clock,
 * PG store, identity, notifier, and post-commit scheduler to one commerce
 * instance. The production singleton is created on first use. Tests call the
 * factory directly and pass that instance into the app wrappers.
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { findPlanByProviderPriceId, getPlanById, type PricingPlan } from "@/config/pricing";
import { isPurchaseEnabled } from "@/config/features";
import { PRODUCT_ID } from "@/config/product";
import { siteConfig } from "@/config/site";
import { db } from "@/lib/db";
import { getLogger, type AppLogger } from "@/lib/logger";
import {
  createCommerce,
  type Commerce,
  type CommerceCatalog,
  type CommerceDeps,
} from "@sunpcm/niu-commerce";
import { createPgCommerceStore, type PgCommerceStore } from "@sunpcm/niu-persistence-pg/commerce";

export interface AppCommerceOptions {
  productId?: string;
  catalog?: CommerceCatalog;
  clock?: CommerceDeps["clock"];
  logger?: AppLogger;
  schedulePostCommit?: CommerceDeps["schedulePostCommit"];
  notifier?: CommerceDeps["notifier"];
  mailer?: CommerceDeps["mailer"];
  purchasesEnabled?: boolean;
  store?: PgCommerceStore;
  identity?: CommerceDeps["identity"];
  cancelSubscription?: CommerceDeps["cancelSubscription"];
}

export interface AppCommerce {
  commerce: Commerce;
  store: PgCommerceStore;
}

const defaultCatalog: CommerceCatalog = {
  getPlanById: (id) => getPlanById(id) as PricingPlan | undefined,
  findPlanByProviderPriceId: (provider, id) =>
    findPlanByProviderPriceId(provider, id) as PricingPlan | undefined,
};

function productionSchedule(task: () => void | Promise<void>): void {
  const require = createRequire(import.meta.url);
  const loaded = require("next/server") as { after?: (task: () => Promise<void>) => void };
  if (typeof loaded.after !== "function") {
    throw new Error(
      "next/server did not export after; commerce post-commit work was not registered",
    );
  }
  loaded.after(() =>
    Promise.resolve()
      .then(() => task())
      .catch((error: unknown) => {
        getLogger("billing.commerce").error({ err: error }, "Commerce post-commit task failed");
      }),
  );
}

async function productionPrincipal() {
  const { getFreshSession } = await import("@/lib/auth/server");
  // getFreshSession re-reads ban state and returns null while isBanActive
  // is true. A returned session has passed that guard, so a stale
  // user.banned flag must not be treated as a live ban. Query failures
  // propagate; they are not turned into an anonymous principal.
  const session = await getFreshSession();
  const userId = session?.user?.id;
  if (!userId) return null;
  return { userId, banned: false, revoked: false };
}

function productionNotifier(): CommerceDeps["notifier"] {
  return {
    onOrderCommitted: async (notice) => {
      const { notifyNewOrder } = await import("@/lib/discord/notifications");
      await notifyNewOrder(notice);
    },
    onDuplicateSubscription: async (notice) => {
      const { notifyDuplicateSubscription } = await import("@/lib/discord/notifications");
      await notifyDuplicateSubscription(notice as never);
    },
    onPaymentDenied: async (notice) => {
      const { notifyPaymentDenied } = await import("@/lib/discord/notifications");
      await notifyPaymentDenied(notice as never);
    },
    onDispute: async (notice) => {
      const { notifyDispute } = await import("@/lib/discord/notifications");
      await notifyDispute(notice as never);
    },
  };
}

async function productionMailer(): Promise<CommerceDeps["mailer"]> {
  return {
    async send(message) {
      const { sendEmail } = await import("@/lib/mail");
      const { InvoicePaymentFailedEmail } = await import("@/emails/invoice-payment-failed");
      if (message.template !== "invoice-payment-failed") {
        throw new Error(`Unknown commerce mail template ${message.template}`);
      }
      await sendEmail({
        to: message.to,
        from: message.from,
        subject: message.subject,
        react: InvoicePaymentFailedEmail,
        reactProps: message.props,
      });
    },
  };
}

export function createAppCommerce(options: AppCommerceOptions = {}): AppCommerce {
  const store = options.store ?? createPgCommerceStore(db);
  const self: { commerce?: Commerce } = {};
  const commerce = createCommerce({
    productId: options.productId ?? PRODUCT_ID,
    catalog: options.catalog ?? defaultCatalog,
    clock: options.clock ?? { now: () => new Date() },
    identity: options.identity ?? {
      getFreshPrincipal: productionPrincipal,
      isLiveMember: async (userId, organizationId) => {
        const current = self.commerce;
        if (!current)
          throw new Error("Commerce identity used before the instance finished opening");
        return current.runtime.withUnit(undefined, (unit) =>
          unit.identity.isLiveMember(userId, organizationId),
        );
      },
    },
    store,
    logger: options.logger ?? getLogger("billing.commerce"),
    schedulePostCommit: options.schedulePostCommit ?? productionSchedule,
    notifier: options.notifier ?? productionNotifier(),
    purchasesEnabled: options.purchasesEnabled ?? isPurchaseEnabled(),
    mailer: options.mailer,
    admin: {
      email: process.env.DEFAULT_ADMIN_EMAIL,
      name: process.env.DEFAULT_ADMIN_NAME,
      siteName: siteConfig.name,
      siteUrl: siteConfig.url,
      billingUrl: `${siteConfig.url}/dashboard/billing`,
      supportUrl: process.env.NEXT_PUBLIC_DISCORD_INVITE_URL || siteConfig.url,
    },
    cancelSubscription:
      options.cancelSubscription ??
      (async (provider, providerSubscriptionId, reason) => {
        const { cancelProviderSubscription } = await import("@/lib/billing/cancel");
        return cancelProviderSubscription(provider, providerSubscriptionId, reason);
      }),
  });
  self.commerce = commerce;
  return { commerce, store };
}

let production: Promise<AppCommerce> | undefined;

export function getAppCommerce(): Promise<AppCommerce> {
  production ??= (async () =>
    createAppCommerce({
      mailer: await productionMailer(),
    }))();
  return production;
}

export async function appCreemWebhooks() {
  const require = createRequire(new URL("../../package.json", import.meta.url));
  return import(pathToFileURL(require.resolve("creem/webhooks")).href) as Promise<{
    verifyWebhookSignature(payload: string, headers: Headers, secret: string): Promise<void>;
    parseWebhookEvent(payload: string): { type: string; data?: unknown; id?: string };
    parseWebhookEventEntity(payload: string): { eventType: string; object: unknown };
  }>;
}
