import "server-only";

import { getWorkspaceContext } from "@/lib/auth/server";
import type { NanoSubject } from "@sunpcm/niu-feature-nano";

/**
 * Server-resolved Nano principal. `subject` is the balance-owning subject
 * (exactly one of user/org), while `userId` is always the fresh session user.
 * Clients never supply any of these values; they are derived from the live
 * workspace context (fresh ban/member re-read).
 */
export interface NanoPrincipal {
  userId: string;
  organizationId: string | null;
  actorUserId: string;
  subject: NanoSubject;
}

export async function resolveNanoPrincipal(): Promise<NanoPrincipal | null> {
  const ctx = await getWorkspaceContext();
  if (!ctx) return null;

  if (ctx.organizationId) {
    return {
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      subject: { userId: null, organizationId: ctx.organizationId },
    };
  }

  return {
    userId: ctx.userId,
    organizationId: null,
    actorUserId: ctx.userId,
    subject: { userId: ctx.userId, organizationId: null },
  };
}
