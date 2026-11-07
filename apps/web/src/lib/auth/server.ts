/**
 * Server-only wiring of `lib/auth` guards. Guard rules live in
 * `@sunpcm/niu-auth` (importable in plain Node); `@sunpcm/niu-next` injects
 * `next/headers` and the per-request `React.cache`. The fresh channel re-reads
 * ban state and live membership on every call.
 */

import "server-only";

import { auth, policyStore } from "@/lib/auth";
import { createNextServerGuards } from "@sunpcm/niu-next";

export {
  createServerGuards,
  type ServerGuardsDeps,
  type SessionAuthClient,
  type WorkspaceContext,
} from "@/lib/auth/guards";

export const {
  getSession,
  getFreshSession,
  getWorkspaceContext,
  isAdmin,
  isSuperAdmin,
} = createNextServerGuards({ auth, policyStore });
