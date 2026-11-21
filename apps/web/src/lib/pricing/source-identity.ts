/**
 * [INPUT]: Depends on @/config/pricing for the default plan catalog
 *          (getPlanById / findPlanByProviderPriceId) and the
 *          PaymentProvider/PricingPlan types.
 * [OUTPUT]: Exports SourceIdentityCatalog, defaultSourceIdentityCatalog,
 *           buildSourceIdentityCatalog, resolvePlanBySource
 * [POS]: The single source-identity rule of lib/pricing — the one place that
 *        decides whether an external provider identity (price/product/plan id)
 *        attributes to a local plan. The external id is authoritative when
 *        present: an unknown/foreign id must never fall back to metadata, and
 *        a metadata↔external conflict must never be silently downgraded.
 *        Production runs on the default config catalog; domain tests inject a
 *        test-only catalog (an INPUT, not a copy of this rule) so the same
 *        attribution path is exercised for Creem/PayPal plans that config does
 *        not ship.
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import {
  findPlanByProviderPriceId as configFindPlan,
  getPlanById as configGetPlan,
  type PaymentProvider,
  type PricingPlan,
} from '@/config/pricing';

/**
 * A read-only plan lookup surface. Production wraps @/config/pricing; a test
 * catalog wraps an arbitrary plan list built from the same PricingPlan type —
 * no resolver logic is reimplemented by the fixture.
 */
export interface SourceIdentityCatalog {
  getPlanById(planId: string): PricingPlan | undefined;
  findPlanByProviderPriceId(
    provider: PaymentProvider,
    id: string,
  ): PricingPlan | undefined;
}

export const defaultSourceIdentityCatalog: SourceIdentityCatalog = {
  getPlanById: configGetPlan,
  findPlanByProviderPriceId: configFindPlan,
};

/** The provider-side reference field for a given provider (mirrors config/pricing's lookup). */
function providerPriceRef(
  plan: PricingPlan,
  provider: PaymentProvider,
): { test: string; live: string } | undefined {
  switch (provider) {
    case 'stripe':
      return plan.stripePriceId;
    case 'creem':
      return plan.creemProductId;
    case 'paypal':
      return plan.paypalPlanId;
  }
}

/**
 * Build a catalog from a plan list (test fixture input). The reverse lookup
 * matches the same test/live columns as config/pricing — this is catalog
 * construction, not source-identity policy.
 */
export function buildSourceIdentityCatalog(
  inputPlans: readonly PricingPlan[],
): SourceIdentityCatalog {
  // Own a snapshot: changing a caller's fixture cannot change another instance.
  const plans = structuredClone(inputPlans) as PricingPlan[];
  const freeze = (value: object): void => {
    Object.values(value).forEach((child) => {
      if (child && typeof child === 'object') freeze(child);
    });
    Object.freeze(value);
  };
  plans.forEach(freeze);
  const byId = new Map(plans.map((plan) => [plan.id, plan] as const));
  if (byId.size !== plans.length) throw new Error('Duplicate catalog plan id');
  const refs = new Map<string, string>();
  for (const plan of plans) {
    const ref = providerPriceRef(plan, plan.provider);
    for (const id of ref ? [ref.test, ref.live] : []) {
      if (!id) continue;
      const key = `${plan.provider}/${id}`;
      if (refs.has(key) && refs.get(key) !== plan.id) {
        throw new Error(`Ambiguous provider identity: ${key}`);
      }
      refs.set(key, plan.id);
    }
  }
  return {
    getPlanById: (planId) => byId.get(planId),
    findPlanByProviderPriceId: (provider, id) =>
      plans.find((plan) => {
        const ref = providerPriceRef(plan, provider);
        return plan.provider === provider && ref !== undefined && (ref.test === id || ref.live === id);
      }),
  };
}

/**
 * The shared source-identity rule for all three providers.
 *
 * - No external id → no attribution (null). A missing external identity is
 *   never auto-attributed from metadata: the caller must instead prove a
 *   verified legacy/bound source (a server-side pending/order/subscription
 *   record), never a bare metadata string.
 * - External id present → it is authoritative. Unknown/foreign id rejects
 *   (never metadata fallback). A metadata plan that disagrees with the
 *   external id also rejects — never prefer metadata, never silently degrade.
 */
export function resolvePlanBySource(
  params: {
    provider: PaymentProvider;
    metadataPlanId?: string | null;
    externalId?: string | null;
  },
  catalog: SourceIdentityCatalog,
): PricingPlan | null {
  const { provider, metadataPlanId, externalId } = params;
  const fromMetadata = metadataPlanId
    ? catalog.getPlanById(metadataPlanId)
    : undefined;

  if (!externalId) return null;

  const fromExternal = catalog.findPlanByProviderPriceId(provider, externalId);
  if (!fromExternal || fromExternal.provider !== provider) return null;
  if (metadataPlanId && (!fromMetadata || fromMetadata.provider !== provider)) return null;
  if (fromMetadata && fromMetadata.id !== fromExternal.id) return null;
  return fromExternal;
}
