import { resolvePlanBySource } from "./catalog.js";
import type { CommerceRuntime } from "./context.js";
import type { OrderRow } from "./store.js";
import type { BillingSubject, CommerceCatalog, PaymentProvider } from "./types.js";

export function assertBoundMetadata(
  row: BillingSubject & { planId: string },
  metadata: { planId?: unknown; userId?: unknown; organizationId?: unknown },
): void {
  for (const key of ["planId", "userId", "organizationId"] as const) {
    if (metadata[key] !== undefined && metadata[key] !== null && metadata[key] !== row[key]) {
      throw new Error(`Payment source binding conflict: ${key}`);
    }
  }
}

export async function resolveSubscriptionSource(rt: CommerceRuntime, params: {
  provider: PaymentProvider; subscriptionId: string; externalId?: string | null;
  metadata: { planId?: unknown; userId?: unknown; organizationId?: unknown }; catalog?: CommerceCatalog;
}) {
  const catalog = params.catalog ?? rt.catalog;
  const bound = await rt.withUnit(undefined, (unit) => unit.subscriptions.findByKey(params.provider, params.subscriptionId));
  if (bound) {
    assertBoundMetadata(bound, {
      ...params.metadata,
      planId: params.externalId ? undefined : params.metadata.planId,
    });
  }
  const plan = params.externalId
    ? resolvePlanBySource({
        provider: params.provider, externalId: params.externalId,
        metadataPlanId: typeof params.metadata.planId === "string" ? params.metadata.planId : null,
      }, catalog)
    : bound ? catalog.getPlanById(bound.planId) : undefined;
  if (!plan || plan.provider !== params.provider) return null;
  return {
    plan,
    subject: bound ? { userId: bound.userId, organizationId: bound.organizationId } : null,
    providerPriceId: params.externalId ?? bound?.providerPriceId ?? null,
  };
}

export async function resolveHistoricalOrderSource(rt: CommerceRuntime, params: {
  provider: PaymentProvider; orderId: string;
  metadata: { planId?: unknown; userId?: unknown; organizationId?: unknown }; catalog?: CommerceCatalog;
}): Promise<{ plan: NonNullable<ReturnType<CommerceCatalog["getPlanById"]>>; bound: OrderRow } | null> {
  const catalog = params.catalog ?? rt.catalog;
  const bound = await rt.withUnit(undefined, (unit) => unit.orders.findByProviderOrder(params.provider, params.orderId));
  if (!bound || bound.orderType !== "one_time") return null;
  assertBoundMetadata(bound, params.metadata);
  const plan = catalog.getPlanById(bound.planId);
  return plan?.provider === params.provider ? { plan, bound } : null;
}
