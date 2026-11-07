import type { CommerceCatalog, CommercePlan, PaymentProvider } from "./types.js";

export function isSubscriptionPlan(plan: CommercePlan): boolean {
  return plan.kind === "subscription";
}

export function getPlanCredits(plan: CommercePlan): number {
  return isSubscriptionPlan(plan) ? plan.monthlyCredits ?? 0 : plan.credits ?? 0;
}

function providerPriceRef(plan: CommercePlan, provider: PaymentProvider) {
  switch (provider) {
    case "stripe": return plan.stripePriceId;
    case "creem": return plan.creemProductId;
    case "paypal": return plan.paypalPlanId;
  }
}

export function buildSourceIdentityCatalog(inputPlans: readonly CommercePlan[]): CommerceCatalog {
  const plans = structuredClone(inputPlans) as CommercePlan[];
  const freeze = (value: object): void => {
    Object.values(value).forEach((child) => {
      if (child && typeof child === "object") freeze(child);
    });
    Object.freeze(value);
  };
  plans.forEach(freeze);
  const byId = new Map(plans.map((plan) => [plan.id, plan] as const));
  if (byId.size !== plans.length) throw new Error("Duplicate catalog plan id");
  const refs = new Map<string, string>();
  for (const plan of plans) {
    const ref = providerPriceRef(plan, plan.provider);
    for (const id of ref ? [ref.test, ref.live] : []) {
      if (!id) continue;
      const key = `${plan.provider}/${id}`;
      if (refs.has(key) && refs.get(key) !== plan.id) throw new Error(`Ambiguous provider identity: ${key}`);
      refs.set(key, plan.id);
    }
  }
  return {
    getPlanById: (planId) => byId.get(planId),
    findPlanByProviderPriceId: (provider, id) => plans.find((plan) => {
      const ref = providerPriceRef(plan, provider);
      return plan.provider === provider && ref !== undefined && (ref.test === id || ref.live === id);
    }),
  };
}

export function resolvePlanBySource(
  params: { provider: PaymentProvider; metadataPlanId?: string | null; externalId?: string | null },
  catalog: CommerceCatalog,
): CommercePlan | null {
  const fromMetadata = params.metadataPlanId ? catalog.getPlanById(params.metadataPlanId) : undefined;
  if (!params.externalId) return null;
  const fromExternal = catalog.findPlanByProviderPriceId(params.provider, params.externalId);
  if (!fromExternal || fromExternal.provider !== params.provider) return null;
  if (params.metadataPlanId && (!fromMetadata || fromMetadata.provider !== params.provider)) return null;
  if (fromMetadata && fromMetadata.id !== fromExternal.id) return null;
  return fromExternal;
}
