/**
 * [INPUT]: Depends on @/lib/auth's auth.api (the admin plugin's
 *          impersonateUser / stopImpersonating endpoints — cookies land via
 *          the nextCookies plugin), @/lib/auth/server's getFreshSession
 *          (the superadmin check reads past the cookie cache),
 *          permissions' role predicates, @/lib/db's user table and
 *          @/lib/logger for the audit trail
 * [OUTPUT]: Exports startImpersonation (superadmin borrows a user's session)
 *           and stopImpersonation (hands it back, restoring the admin's own)
 * [POS]: The impersonation channel of actions/users, sibling to admin.ts's
 *        ban/role/delete actions; it lives in its own file because it mutates
 *        no business data — it only swaps the subject of the current session
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use server";

import type { ActionResult } from "@/lib/action-response";
import { actionResponse } from "@/lib/action-response";
import { auth } from "@/lib/auth";
import { isAdminUserRole, isSuperAdminUserRole } from "@/lib/auth/permissions";
import { getFreshSession } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { user as userSchema } from "@/lib/db/schema";
import { getErrorMessage } from "@/lib/error-utils";
import { getLogger } from "@/lib/logger";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";

const logger = getLogger("impersonation");

/* -------------------------------------------------------------------------- */
/*  Borrow a session                                                          */
/*                                                                            */
/*  Three guards, none redundant: two here (caller is superadmin, target is    */
/*  not an admin) and a third inside the plugin (only superadmin holds         */
/*  user:impersonate in the access table). Bypassing this action changes       */
/*  nothing — auth.api issues the session and enforces the third guard itself. */
/* -------------------------------------------------------------------------- */

export async function startImpersonation({
  userId,
}: {
  userId: string;
}): Promise<ActionResult> {
  const session = await getFreshSession();
  if (!session?.user) {
    return actionResponse.forbidden("Authentication required.");
  }
  if (!isSuperAdminUserRole(session.user.role)) {
    return actionResponse.forbidden("Super admin privileges required.");
  }
  if (userId === session.user.id) {
    return actionResponse.badRequest("You are already yourself.");
  }

  try {
    const [target] = await db
      .select({
        id: userSchema.id,
        email: userSchema.email,
        role: userSchema.role,
        banned: userSchema.banned,
      })
      .from(userSchema)
      .where(eq(userSchema.id, userId))
      .limit(1);

    if (!target) {
      return actionResponse.notFound("User not found.");
    }
    if (isAdminUserRole(target.role)) {
      return actionResponse.forbidden("Cannot impersonate admin users.");
    }
    // A banned user cannot even sign in themselves (the session.create hook
    // rejects them), so borrowing would hit the same wall — say so up front
    // instead of forwarding the plugin's BANNED_USER error.
    if (target.banned) {
      return actionResponse.forbidden(
        "User is banned. Unban them first to impersonate."
      );
    }

    // The plugin owns the cookie swap: the admin's own token is stashed in the
    // signed admin_session cookie, and the target's short-lived session takes
    // over the session cookie.
    await auth.api.impersonateUser({
      body: { userId },
      headers: await headers(),
    });

    // Borrowing exposes everything the user can see and can spend their
    // credits — leave an audit trail.
    logger.warn(
      {
        adminId: session.user.id,
        adminEmail: session.user.email,
        targetId: target.id,
        targetEmail: target.email,
      },
      "superadmin started impersonation"
    );

    return actionResponse.success();
  } catch (error: any) {
    return actionResponse.error(getErrorMessage(error));
  }
}

/* -------------------------------------------------------------------------- */
/*  Hand it back                                                              */
/*                                                                            */
/*  No role guard here: the criterion is "this session is borrowed"           */
/*  (session.impersonatedBy is set), which the plugin checks itself. While     */
/*  impersonating, the caller's role is that of a plain user — gating on the   */
/*  role would lock them in.                                                  */
/* -------------------------------------------------------------------------- */

export async function stopImpersonation(): Promise<ActionResult> {
  try {
    const restored = await auth.api.stopImpersonating({
      headers: await headers(),
    });

    logger.warn(
      { adminId: restored?.session?.userId },
      "superadmin stopped impersonation"
    );

    return actionResponse.success();
  } catch (error: any) {
    return actionResponse.error(getErrorMessage(error));
  }
}
