/**
 * Server session guards. Thin adapter over `@sunpcm/niu-auth`'s
 * `createServerGuards`: the core owns the fresh ban/member/role re-read rules;
 * this file keeps the legacy `{ auth, db, getHeaders }` shape for the domain
 * tests and other plain-Node callers by binding `db` to an Auth policy store.
 * The fresh channel re-reads ban state and live membership on every call
 * (never a trusted role cached across requests).
 */
import {
  createServerGuards as createCoreServerGuards,
  type GuardSessionShape,
  type GuardUserShape,
  type SessionAuthClient,
  type WorkspaceContext,
} from "@sunpcm/niu-auth";
import { createAuthPolicyStore } from "@sunpcm/niu-persistence-pg/auth";

import type { Db } from "@/lib/auth/types";

export type {
  GuardSessionShape,
  GuardUserShape,
  SessionAuthClient,
  WorkspaceContext,
};

export interface ServerGuardsDeps<
  TSession extends GuardSessionShape = GuardSessionShape,
  TUser extends GuardUserShape = GuardUserShape,
> {
  auth: SessionAuthClient<TSession, TUser>;
  db: Db;
  /** Request-context port: the current request headers (cookie-carrying). */
  getHeaders: () => Promise<Headers>;
}

export function createServerGuards<
  TSession extends GuardSessionShape = GuardSessionShape,
  TUser extends GuardUserShape = GuardUserShape,
>(deps: ServerGuardsDeps<TSession, TUser>) {
  const { auth, db, getHeaders } = deps;
  // Guards only read ban state and live membership, neither of which needs the
  // billing query port, so seat compensation stays disabled here.
  const policyStore = createAuthPolicyStore({
    db,
    billingQueries: null,
  });

  return createCoreServerGuards<TSession, TUser>({
    auth,
    policyStore,
    getHeaders,
  });
}
