import {
  adminClient,
  emailOTPClient,
  lastLoginMethodClient,
  magicLinkClient,
  oneTapClient,
  organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { adminAccessControl, adminAccessRoles } from "./admin-access.js";

export interface AuthClientOneTapConfig {
  clientId: string;
  autoSelect?: boolean;
  cancelOnTapOutside?: boolean;
}

export interface AuthClientCapabilities {
  oneTap?: AuthClientOneTapConfig;
  magicLink?: boolean;
  emailOTP?: boolean;
  lastLoginMethod?: boolean;
  organization?: boolean;
  admin?: boolean;
}

export interface AuthClientOptions {
  baseURL?: string;
  capabilities?: AuthClientCapabilities;
}

export function createAuthClientInstance(options: AuthClientOptions = {}) {
  const capabilities = options.capabilities ?? {};

  return createAuthClient({
    baseURL: options.baseURL,
    plugins: [
      ...(capabilities.oneTap
        ? [
            oneTapClient({
              clientId: capabilities.oneTap.clientId,
              autoSelect: capabilities.oneTap.autoSelect ?? false,
              cancelOnTapOutside:
                capabilities.oneTap.cancelOnTapOutside ?? true,
              context: "signin",
              promptOptions: { fedCM: false },
            }),
          ]
        : []),
      ...(capabilities.magicLink ? [magicLinkClient()] : []),
      ...(capabilities.emailOTP ? [emailOTPClient()] : []),
      ...(capabilities.lastLoginMethod ? [lastLoginMethodClient()] : []),
      ...(capabilities.organization ? [organizationClient()] : []),
      ...(capabilities.admin
        ? [adminClient({ ac: adminAccessControl, roles: adminAccessRoles })]
        : []),
    ],
  });
}
