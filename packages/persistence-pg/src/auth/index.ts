/**
 * PostgreSQL implementation of `@sunpcm/niu-auth`'s `AuthPolicyStore`.
 * Owns identity/member/invitation reads and atomic over-cap compensation.
 * Billing concerns are injected as `AuthPgBillingQueries`; this file never
 * imports the Commerce schema and never touches subscriptions / credit
 * transactions. Drizzle types stay inside this PG adapter.
 */
import { and, count, eq, gt, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { AuthPolicyStore, OrgSeatCap } from "@sunpcm/niu-auth";
import { invitation, member, user } from "../schema/auth.js";

type PgAuthSchema = Record<string, unknown>;

/** A Drizzle db or transaction handle: the subset used by billing seat reads. */
export type AuthPgQueryable<
  TSchema extends PgAuthSchema = PgAuthSchema,
> = Pick<PostgresJsDatabase<TSchema>, "select">;

/**
 * Commerce billing seat-cap query, injected by the owning Commerce adapter.
 * Receives the live queryable (db or transaction) so the seat read stays on the
 * same connection/lock as the enclosing compensation transaction.
 */
export interface AuthPgBillingQueries<
  TSchema extends PgAuthSchema = PgAuthSchema,
> {
  getOrgSeatCap(
    queryable: AuthPgQueryable<TSchema>,
    organizationId: string,
  ): Promise<OrgSeatCap>;
}

/**
 * Fixed-seat counterpart of the Commerce seat query, for a product that enables
 * organizations without Commerce. It ignores the queryable and reads no billing
 * table; pair it with `createStaticBillingPort` from `@sunpcm/niu-auth`.
 */
export function createStaticAuthPgBillingQueries<
  TSchema extends PgAuthSchema = PgAuthSchema,
>(options: { seats: number }): AuthPgBillingQueries<TSchema> {
  const { seats } = options;
  if (!Number.isSafeInteger(seats) || seats < 1) {
    throw new Error("Static billing queries require seats to be a positive integer.");
  }
  return {
    getOrgSeatCap: async () => ({ seats, hasTeamSubscription: true }),
  };
}

export interface AuthPolicyStoreDeps<
  TSchema extends PgAuthSchema = PgAuthSchema,
> {
  db: PostgresJsDatabase<TSchema>;
  /**
   * `null` = billing explicitly disabled. Identity/member reads still work;
   * `reclaim*` throws because seat compensation has no billing source.
   */
  billingQueries: AuthPgBillingQueries<TSchema> | null;
}

export function createAuthPolicyStore<TSchema extends PgAuthSchema>(
  deps: AuthPolicyStoreDeps<TSchema>,
): AuthPolicyStore {
  const { db, billingQueries } = deps;

  function requireBillingQueries(): AuthPgBillingQueries<TSchema> {
    if (!billingQueries) {
      throw new Error(
        "Seat compensation requires a billing query port, but billing is disabled.",
      );
    }
    return billingQueries;
  }

  return {
    async getBanStatus(userId) {
      const [row] = await db
        .select({ banned: user.banned, banExpires: user.banExpires })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      return {
        banned: row?.banned ?? null,
        banExpires: row?.banExpires ?? null,
      };
    },

    async isLiveMember(organizationId, userId) {
      const [row] = await db
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.organizationId, organizationId),
            eq(member.userId, userId),
          ),
        )
        .limit(1);
      return !!row;
    },

    async isOrganizationOwner(userId) {
      const [row] = await db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.userId, userId), eq(member.role, "owner")))
        .limit(1);
      return !!row;
    },

    async countMembers(organizationId) {
      const [{ value }] = await db
        .select({ value: count() })
        .from(member)
        .where(eq(member.organizationId, organizationId));
      return value;
    },

    async countPendingInvitations(organizationId, nowDate) {
      const [{ value }] = await db
        .select({ value: count() })
        .from(invitation)
        .where(
          and(
            eq(invitation.organizationId, organizationId),
            eq(invitation.status, "pending"),
            gt(invitation.expiresAt, nowDate),
          ),
        );
      return value;
    },

    async reclaimMemberSeatIfOverCap({ organizationId, addedId }) {
      const billing = requireBillingQueries();
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${"org-seats-" + organizationId}))`,
        );
        const { seats } = await billing.getOrgSeatCap(tx, organizationId);
        const rows = await tx
          .select({ id: member.id })
          .from(member)
          .where(eq(member.organizationId, organizationId));
        const excess = rows.length - seats;
        if (excess <= 0) return null;
        await tx.delete(member).where(eq(member.id, addedId));
        return seats;
      });
    },

    async reclaimInvitationSeatIfOverCap({
      organizationId,
      addedId,
      now: nowDate,
    }) {
      const billing = requireBillingQueries();
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${"org-seats-" + organizationId}))`,
        );
        const { seats } = await billing.getOrgSeatCap(tx, organizationId);
        const [{ value: memberCount }] = await tx
          .select({ value: count() })
          .from(member)
          .where(eq(member.organizationId, organizationId));
        const pending = await tx
          .select({ id: invitation.id })
          .from(invitation)
          .where(
            and(
              eq(invitation.organizationId, organizationId),
              eq(invitation.status, "pending"),
              gt(invitation.expiresAt, nowDate),
            ),
          );
        const excess = memberCount + pending.length - seats;
        if (excess <= 0) return null;
        await tx.delete(invitation).where(eq(invitation.id, addedId));
        return seats;
      });
    },
  };
}
