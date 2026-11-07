/**
 * Organization plugin. Thin re-export of `@sunpcm/niu-auth`'s
 * `createOrganizationPlugin`. The application no longer constructs this plugin
 * by hand: `@sunpcm/niu-auth`'s `createAuth` builds it internally when
 * `capabilities.organization` is enabled, wiring the injected policy store,
 * billing port and mail transport.
 */
export { createOrganizationPlugin } from "@sunpcm/niu-auth";
export type { OrganizationPluginDeps } from "@sunpcm/niu-auth";
