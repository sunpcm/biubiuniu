import { APIError } from "better-auth/api";
import { organization } from "better-auth/plugins";

import type { AuthBillingPort, AuthPolicyStore } from "./policy-store.js";
import type { AuthMailer, AuthSiteInfo } from "./types.js";

export interface OrganizationPluginDeps {
  policyStore: AuthPolicyStore;
  billing: AuthBillingPort;
  mail: AuthMailer;
  site: AuthSiteInfo;
  clock?: () => Date;
}

const seatsFullMessage = (seats: number) =>
  `All ${seats} seats of your team plan are taken. Remove a member or upgrade your plan.`;

async function assertSeatAvailable(
  policyStore: AuthPolicyStore,
  billing: AuthBillingPort,
  organizationId: string,
  opts: { includePendingInvitations: boolean; now: () => Date },
): Promise<void> {
  const { seats, hasTeamSubscription } =
    await billing.getOrgSeatCap(organizationId);

  const memberCount = await policyStore.countMembers(organizationId);

  let reserved = 0;
  if (opts.includePendingInvitations) {
    reserved = await policyStore.countPendingInvitations(
      organizationId,
      opts.now(),
    );
  }

  if (memberCount + reserved >= seats) {
    throw new APIError("FORBIDDEN", {
      message: hasTeamSubscription
        ? seatsFullMessage(seats)
        : "Inviting members requires an active team subscription.",
    });
  }
}

export function createOrganizationPlugin(deps: OrganizationPluginDeps) {
  const { policyStore, billing, mail, site } = deps;
  const now = deps.clock ?? (() => new Date());

  const sendOrganizationInvitation = mail.sendOrganizationInvitation;
  if (!sendOrganizationInvitation) {
    throw new Error(
      'Auth capability "organization" requires mail.sendOrganizationInvitation.',
    );
  }

  return organization({
    creatorRole: "owner",
    organizationLimit: 5,
    membershipLimit: 100,
    invitationExpiresIn: 60 * 60 * 48,
    cancelPendingInvitationsOnReInvite: true,
    sendInvitationEmail: async (data) => {
      const url = `${site.url}/accept-invitation/${data.id}`;
      await sendOrganizationInvitation({
        email: data.email,
        url,
        organizationName: data.organization.name,
        inviterName: data.inviter.user?.name,
        inviterEmail: data.inviter.user?.email,
      });
    },
    organizationHooks: {
      beforeCreateInvitation: async ({ invitation: pending }) => {
        await assertSeatAvailable(policyStore, billing, pending.organizationId, {
          includePendingInvitations: true,
          now,
        });
      },
      afterCreateInvitation: async ({ invitation: created }) => {
        const rejected = await policyStore.reclaimInvitationSeatIfOverCap({
          organizationId: created.organizationId,
          addedId: created.id,
          now: now(),
        });
        if (rejected !== null) {
          throw new APIError("FORBIDDEN", { message: seatsFullMessage(rejected) });
        }
      },
      beforeAcceptInvitation: async ({ invitation: accepting }) => {
        await assertSeatAvailable(policyStore, billing, accepting.organizationId, {
          includePendingInvitations: false,
          now,
        });
      },
      afterAcceptInvitation: async ({ member: added }) => {
        const rejected = await policyStore.reclaimMemberSeatIfOverCap({
          organizationId: added.organizationId,
          addedId: added.id,
        });
        if (rejected !== null) {
          throw new APIError("FORBIDDEN", { message: seatsFullMessage(rejected) });
        }
      },
      beforeAddMember: async ({ member: joining }) => {
        await assertSeatAvailable(policyStore, billing, joining.organizationId, {
          includePendingInvitations: false,
          now,
        });
      },
      afterAddMember: async ({ member: added }) => {
        const rejected = await policyStore.reclaimMemberSeatIfOverCap({
          organizationId: added.organizationId,
          addedId: added.id,
        });
        if (rejected !== null) {
          throw new APIError("FORBIDDEN", { message: seatsFullMessage(rejected) });
        }
      },
      beforeDeleteOrganization: async ({ organization: org }) => {
        const blockers =
          await billing.getOrganizationDeletionBlockers(org.id);
        if (blockers.hasTeamSubscription) {
          throw new APIError("FORBIDDEN", {
            message:
              "This team has an active subscription. Cancel it before deleting the team.",
          });
        }
        if (blockers.hasBillingHistory) {
          throw new APIError("FORBIDDEN", {
            message:
              "This team has billing history and cannot be deleted. Contact support if you need it archived.",
          });
        }
      },
    },
  });
}
