/**
 * Domain-store contracts for the auth rules.
 *
 * `AuthPolicyStore` only covers identity/member/invitation capabilities; it is
 * implemented by the PostgreSQL auth adapter and must never reach billing
 * tables. `AuthBillingPort` is the app-injected Commerce query capability: seat
 * cap, personal-subscription liveness, and organization billing history. The
 * auth core never imports SQL or Commerce.
 */

export interface BanStatus {
  banned: boolean | null;
  banExpires: Date | string | number | null;
}

export interface OrgSeatCap {
  seats: number;
  hasTeamSubscription: boolean;
}

export interface OrganizationDeletionBlockers {
  hasTeamSubscription: boolean;
  hasBillingHistory: boolean;
}

export interface AuthPolicyStore {
  /** Fresh ban state for a user (re-read on every privileged check). */
  getBanStatus(userId: string): Promise<BanStatus>;

  /** Whether the user is a current member of the organization. */
  isLiveMember(organizationId: string, userId: string): Promise<boolean>;

  /** Whether the user owns any organization (owner role). */
  isOrganizationOwner(userId: string): Promise<boolean>;

  countMembers(organizationId: string): Promise<number>;

  countPendingInvitations(organizationId: string, now: Date): Promise<number>;

  /**
   * Atomic over-cap convergence for a newly inserted member: advisory lock,
   * recount, delete only this call's row, commit, then report the over-cap seat
   * count (null when within cap). The caller throws AFTER the adapter commits.
   */
  reclaimMemberSeatIfOverCap(input: {
    organizationId: string;
    addedId: string;
  }): Promise<number | null>;

  /**
   * Atomic over-cap convergence for a newly created pending invitation. Same
   * delete-own-row + throw-after-commit contract as the member variant.
   */
  reclaimInvitationSeatIfOverCap(input: {
    organizationId: string;
    addedId: string;
    now: Date;
  }): Promise<number | null>;
}

/**
 * Commerce/billing query capability, injected by the composition layer. When
 * billing is enabled but this port is absent, assembly fails; when billing is
 * disabled this port is never called and no billing table is touched.
 */
export interface AuthBillingPort {
  /** Seat cap = the organization's current live team subscription plan seats. */
  getOrgSeatCap(organizationId: string): Promise<OrgSeatCap>;

  /** Whether the user has a live personal subscription (blocks deletion). */
  hasLivePersonalSubscription(userId: string): Promise<boolean>;

  /** Financial-retention blockers for organization deletion. */
  getOrganizationDeletionBlockers(
    organizationId: string,
  ): Promise<OrganizationDeletionBlockers>;
}

/**
 * Fixed-seat billing port for a product that enables organizations without
 * Commerce. Every organization gets the same seat cap, there is no personal
 * subscription, and nothing blocks organization deletion. It never touches a
 * billing table, so it works with the `auth` migration profile alone.
 *
 * `hasTeamSubscription` is reported as true so a full team gets the "all seats
 * are taken" message rather than "requires an active team subscription".
 */
export function createStaticBillingPort(options: { seats: number }): AuthBillingPort {
  const { seats } = options;
  if (!Number.isSafeInteger(seats) || seats < 1) {
    throw new Error("Static billing port requires seats to be a positive integer.");
  }
  return {
    getOrgSeatCap: async () => ({ seats, hasTeamSubscription: true }),
    hasLivePersonalSubscription: async () => false,
    getOrganizationDeletionBlockers: async () => ({
      hasTeamSubscription: false,
      hasBillingHistory: false,
    }),
  };
}
