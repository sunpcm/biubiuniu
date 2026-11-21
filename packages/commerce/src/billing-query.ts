import type { CommerceUnit } from "./store.js";
import { ENTITLED_SUBSCRIPTION_STATUSES, type CanonicalSubscriptionStatus } from "./types.js";

/**
 * Narrow billing facts for a caller that already holds a CommerceUnit.
 *
 * Auth's production injection point is `createPgCommerceBillingQueries` in the
 * PG adapter: its methods take the caller's db or compensation transaction
 * directly. Use this helper only after `bindPgCommerceUnit(tx)` or inside
 * `commerce.join(unit)`. Do not call `store.transaction()` from inside that
 * transaction. Commerce does not import Auth. Seat numbers come from the
 * injected catalog.
 */
export interface CommerceBillingQuery {
  userHasLiveSubscription(userId: string): Promise<boolean>;
  liveOrganizationPlan(
    organizationId: string,
  ): Promise<{ planId: string; status: CanonicalSubscriptionStatus } | null>;
  liveOrganizationSeat(
    organizationId: string,
    seatCatalog: (planId: string | null | undefined) => number,
  ): Promise<{ planId: string | null; seats: number; hasTeamSubscription: boolean }>;
  organizationHasBillingHistory(organizationId: string): Promise<boolean>;
}

export function commerceBillingReads(
  unit: CommerceUnit,
  entitled: readonly string[] = ENTITLED_SUBSCRIPTION_STATUSES,
): CommerceBillingQuery {
  return {
    userHasLiveSubscription(userId) {
      return unit.billing.userHasLiveSubscription(userId, entitled);
    },
    liveOrganizationPlan(organizationId) {
      return unit.billing.findLiveOrganizationPlan(organizationId, entitled);
    },
    async liveOrganizationSeat(organizationId, seatCatalog) {
      const plan = await unit.billing.findLiveOrganizationPlan(organizationId, entitled);
      return {
        planId: plan?.planId ?? null,
        seats: seatCatalog(plan?.planId),
        hasTeamSubscription: plan != null,
      };
    },
    organizationHasBillingHistory(organizationId) {
      return unit.billing.organizationHasBillingHistory(organizationId);
    },
  };
}
