/**
 * Pure server-side session guards. Importable in plain Node (no React.cache,
 * no next/headers): the request headers arrive through the injected port. Fresh
 * channel re-reads ban state so revocation / demotion / ban take effect at once.
 */

import { isBanActive } from "./ban-policy.js";
import { isAdminUserRole, isSuperAdminUserRole } from "./permissions.js";
import type { AuthPolicyStore } from "./policy-store.js";

export interface GuardSessionShape {
  id: string;
  activeOrganizationId?: string | null;
}

export interface GuardUserShape {
  id: string;
  role?: string | null;
}

export interface SessionAuthClient<
  TSession extends GuardSessionShape = GuardSessionShape,
  TUser extends GuardUserShape = GuardUserShape,
> {
  api: {
    getSession(input: {
      headers: Headers;
      query?: { disableCookieCache?: boolean; disableRefresh?: boolean };
    }): Promise<{ session: TSession; user: TUser } | null>;
  };
}

export interface ServerGuardsDeps<
  TSession extends GuardSessionShape = GuardSessionShape,
  TUser extends GuardUserShape = GuardUserShape,
> {
  auth: SessionAuthClient<TSession, TUser>;
  policyStore: AuthPolicyStore;
  getHeaders: () => Promise<Headers>;
  /**
   * Per-request memoizer. The Next adapter injects React.cache; plain Node uses
   * the identity default. Must never cache across requests (no trusted role).
   */
  memoize?: <T extends (...args: never[]) => unknown>(fn: T) => T;
}

export interface WorkspaceContext {
  userId: string;
  organizationId: string | null;
}

export function createServerGuards<
  TSession extends GuardSessionShape,
  TUser extends GuardUserShape,
>(deps: ServerGuardsDeps<TSession, TUser>) {
  const { auth, policyStore, getHeaders } = deps;
  const memoize = deps.memoize ?? ((fn) => fn);

  const getSession = memoize(async () =>
    auth.api.getSession({ headers: await getHeaders() }),
  );

  const getFreshSession = memoize(async () => {
    const session = await auth.api.getSession({
      headers: await getHeaders(),
      query: { disableCookieCache: true, disableRefresh: true },
    });
    if (!session?.user) return null;

    const ban = await policyStore.getBanStatus(session.user.id);
    if (isBanActive(ban.banned, ban.banExpires)) return null;
    return session;
  });

  const getWorkspaceContext = async (): Promise<WorkspaceContext | null> => {
    const session = await getFreshSession();
    if (!session?.user) return null;

    const activeOrganizationId = session.session.activeOrganizationId ?? null;
    if (!activeOrganizationId) {
      return { userId: session.user.id, organizationId: null };
    }

    const live = await policyStore.isLiveMember(
      activeOrganizationId,
      session.user.id,
    );
    return {
      userId: session.user.id,
      organizationId: live ? activeOrganizationId : null,
    };
  };

  const isAdmin = async (): Promise<boolean> => {
    const session = await getFreshSession();
    return isAdminUserRole(session?.user?.role);
  };

  const isSuperAdmin = async (): Promise<boolean> => {
    const session = await getFreshSession();
    return isSuperAdminUserRole(session?.user?.role);
  };

  return {
    getSession,
    getFreshSession,
    getWorkspaceContext,
    isAdmin,
    isSuperAdmin,
  };
}
