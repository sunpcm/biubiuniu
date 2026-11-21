/** Role predicates over the three-role model. Pure, no session/redirect dependency. */

export function isAdminUserRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "superadmin";
}

export function isSuperAdminUserRole(role: string | null | undefined): boolean {
  return role === "superadmin";
}
