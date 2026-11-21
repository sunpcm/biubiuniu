import {
  createAccessControl,
  role,
  type AccessControl,
} from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";

export const adminAccessControl: AccessControl =
  createAccessControl(defaultStatements);

const ADMIN_USER_ACTIONS = ["list", "get", "ban"] as const;

const SUPERADMIN_USER_ACTIONS = [
  "list",
  "get",
  "ban",
  "create",
  "set-role",
  "delete",
  "set-password",
  "update",
] as const;

const SESSION_ACTIONS = ["list", "revoke", "delete"] as const;

export const adminAccessRoles = {
  user: role({ user: [], session: [] }),
  admin: role({
    user: [...ADMIN_USER_ACTIONS],
    session: [...SESSION_ACTIONS],
  }),
  superadmin: role({
    user: [...SUPERADMIN_USER_ACTIONS, "impersonate"],
    session: [...SESSION_ACTIONS],
  }),
};

export const IMPERSONATION_SESSION_DURATION_SECONDS = 60 * 60;
