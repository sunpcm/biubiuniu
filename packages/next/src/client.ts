/**
 * Next client entry. Kept physically separate from `@sunpcm/niu-auth/client` so
 * the server-only root barrel never pulls browser/Next code. The auth client
 * itself lives in `@sunpcm/niu-auth/client`; this re-export gives Next consumers
 * a single entry.
 */
export {
  createAuthClientInstance,
  type AuthClientCapabilities,
  type AuthClientOneTapConfig,
  type AuthClientOptions,
} from "@sunpcm/niu-auth/client";
