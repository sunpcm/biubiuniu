import { cookies, headers } from "next/headers.js";
import { redirect } from "next/navigation.js";
import { cache } from "react";
import { nextCookies, toNextJsHandler } from "better-auth/next-js";
import {
  createServerGuards,
  pickClientIP,
  type AuthPolicyStore,
  type GuardSessionShape,
  type GuardUserShape,
  type SessionAuthClient,
  type WorkspaceContext,
} from "@sunpcm/niu-auth";

export { nextCookies, toNextJsHandler };

/**
 * Next-specific plugins, assembled last by `createAuth`. `nextCookies` must be
 * the final plugin so it can rewrite cookie handling for Next's request/response
 * model.
 */
export function createNextAuthPlugins() {
  return [nextCookies()];
}

export interface NextServerGuardsDeps<
  TSession extends GuardSessionShape,
  TUser extends GuardUserShape,
> {
  auth: SessionAuthClient<TSession, TUser>;
  policyStore: AuthPolicyStore;
}

export interface NextServerGuards<
  TSession extends GuardSessionShape,
  TUser extends GuardUserShape,
> {
  getSession(): Promise<{ session: TSession; user: TUser } | null>;
  getFreshSession(): Promise<{ session: TSession; user: TUser } | null>;
  getWorkspaceContext(): Promise<WorkspaceContext | null>;
  isAdmin(): Promise<boolean>;
  isSuperAdmin(): Promise<boolean>;
  requireUser(redirectTo?: string): Promise<{ session: TSession; user: TUser }>;
  requireAdmin(redirectTo?: string): Promise<void>;
  requireSuperAdmin(redirectTo?: string): Promise<void>;
}

/**
 * Next server guards: the permission decisions stay in `@sunpcm/niu-auth`
 * (fresh state every call); this adapter only injects `next/headers` and the
 * per-request `React.cache`. No trusted role is cached across requests.
 */
export function createNextServerGuards<
  TSession extends GuardSessionShape,
  TUser extends GuardUserShape,
>(deps: NextServerGuardsDeps<TSession, TUser>): NextServerGuards<TSession, TUser> {
  const guards = createServerGuards({
    auth: deps.auth,
    policyStore: deps.policyStore,
    getHeaders: async () => await headers(),
    memoize: cache,
  });

  return {
    getSession: guards.getSession,
    getFreshSession: guards.getFreshSession,
    getWorkspaceContext: guards.getWorkspaceContext,
    isAdmin: guards.isAdmin,
    isSuperAdmin: guards.isSuperAdmin,
    requireUser: async (redirectTo = "/login") => {
      const session = await guards.getFreshSession();
      if (!session?.user) redirect(redirectTo);
      return session;
    },
    requireAdmin: async (redirectTo = "/login") => {
      if (!(await guards.isAdmin())) redirect(redirectTo);
    },
    requireSuperAdmin: async (redirectTo = "/login") => {
      if (!(await guards.isSuperAdmin())) redirect(redirectTo);
    },
  };
}

/** Request-context signal from Next's `headers()` / `cookies()`. */
export function createNextRequestSignal() {
  return {
    getClientIP: async (): Promise<string> => {
      const h = await headers();
      return pickClientIP((name) => h.get(name));
    },
    getCookie: async (name: string): Promise<string | undefined> => {
      return (await cookies()).get(name)?.value;
    },
  };
}
