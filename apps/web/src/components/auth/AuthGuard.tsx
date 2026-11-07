/**
 * [INPUT]: Depends on @/lib/auth/server's getSession / getFreshSession,
 *          @/lib/auth/permissions' isAdminUserRole, next/navigation's redirect
 * [OUTPUT]: Exports the AuthGuard server component
 * [POS]: The route-level gate of components/auth, wrapped around
 *        dashboard/layout.tsx (login) and dashboard/admin/layout.tsx (role).
 *        A role check goes through the fresh-session channel so a demotion, a
 *        ban or a revoke takes effect immediately; a plain login check stays on
 *        the cookie-cache hot path
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { getFreshSession, getSession } from "@/lib/auth/server";
import { isAdminUserRole } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export async function AuthGuard({
  children,
  role,
}: {
  children: React.ReactNode;
  role?: string;
}) {
  // Only a role check pays the round trip to the session table; the plain
  // "is anyone logged in" case keeps the 600s cookie cache
  const session = role ? await getFreshSession() : await getSession();

  // dashboard/*
  if (!session) {
    redirect("/login");
  }

  // dashboard/admin/*
  const userRole = session.user.role;
  if (role === "admin" && !isAdminUserRole(userRole)) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
