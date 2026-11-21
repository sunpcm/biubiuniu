/**
 * Client entry point of `lib/auth`. Each client capability matches its
 * server-side counterpart; the access table is the same one `@sunpcm/niu-auth`
 * ships, so `ImpersonationBanner` still reads `impersonatedBy` from the
 * session type.
 */

import { createAuthClientInstance } from "@sunpcm/niu-auth/client";

export const authClient = createAuthClientInstance({
  baseURL:
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL || process.env.NEXT_PUBLIC_SITE_URL,
  capabilities: {
    ...(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
      ? {
          oneTap: {
            clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
            autoSelect: false,
            cancelOnTapOutside: true,
          },
        }
      : {}),
    magicLink: true,
    emailOTP: true,
    lastLoginMethod: true,
    organization: true,
    admin: true,
  },
});
