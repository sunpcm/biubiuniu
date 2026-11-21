/** Source binding wrapper. Rules stay in the commerce package. */

import { getAppCommerce, type AppCommerce } from "@/composition/commerce";
import type { PaymentProvider } from "@/config/pricing";

type SourceMetadata = { planId?: unknown; userId?: unknown; organizationId?: unknown };

export function createSourceBindingBilling(app: AppCommerce) {
  const commerce = app.commerce;
  return {
    assertBoundMetadata(
      order: Parameters<AppCommerce["commerce"]["assertBoundMetadata"]>[0],
      decoded: Parameters<AppCommerce["commerce"]["assertBoundMetadata"]>[1],
    ) {
      return commerce.assertBoundMetadata(order, decoded);
    },
    resolveSubscriptionSource(params: {
      provider: PaymentProvider;
      subscriptionId: string;
      externalId?: string | null;
      metadata?: SourceMetadata | null;
      catalog?: AppCommerce["commerce"]["runtime"]["catalog"];
    }) {
      return commerce.resolveSubscriptionSource({
        ...params,
        metadata: params.metadata ?? {},
      });
    },
    resolveHistoricalOrderSource(params: {
      provider: PaymentProvider;
      orderId: string;
      metadata?: SourceMetadata | null;
      catalog?: AppCommerce["commerce"]["runtime"]["catalog"];
    }) {
      return commerce.resolveHistoricalOrderSource({
        ...params,
        metadata: params.metadata ?? {},
      });
    },
  };
}

export type SourceBindingBilling = ReturnType<typeof createSourceBindingBilling>;

async function defaultBilling(): Promise<SourceBindingBilling> {
  return createSourceBindingBilling(await getAppCommerce());
}

export function assertBoundMetadata(
  order: Parameters<AppCommerce["commerce"]["assertBoundMetadata"]>[0],
  decoded: Parameters<AppCommerce["commerce"]["assertBoundMetadata"]>[1],
) {
  return defaultBilling().then((billing) => billing.assertBoundMetadata(order, decoded));
}

export function resolveSubscriptionSource(params: {
  provider: PaymentProvider;
  subscriptionId: string;
  externalId?: string | null;
  metadata?: SourceMetadata | null;
  catalog?: AppCommerce["commerce"]["runtime"]["catalog"];
}) {
  return defaultBilling().then((billing) => billing.resolveSubscriptionSource(params));
}

export function resolveHistoricalOrderSource(params: {
  provider: PaymentProvider;
  orderId: string;
  metadata?: SourceMetadata | null;
  catalog?: AppCommerce["commerce"]["runtime"]["catalog"];
}) {
  return defaultBilling().then((billing) => billing.resolveHistoricalOrderSource(params));
}
