/**
 * Compile-time regression for the public session guard contract.
 *
 * A real Next tarball consumer can enable `admin` without `organization`; the
 * resulting session carries `id`/`userId`/`impersonatedBy` but has no
 * `activeOrganizationId`. `GuardSessionShape` must accept that basic session
 * AND the organization-extended session, without widening away the precise
 * returned fields. This file is type-checked only and never a runtime entry.
 */

import {
  type AuthInstance,
  type GuardSessionShape,
  type GuardUserShape,
  type SessionAuthClient,
} from "@sunpcm/niu-auth";
import { createNextAuthPlugins } from "./index.js";

type Plugins = ReturnType<typeof createNextAuthPlugins>;

// The exact `createAuth` return types for the two production configurations.
type BasicAuth = AuthInstance<{ admin: true }, Plugins>;
type OrgAuth = AuthInstance<{ admin: true; organization: true }, Plugins>;

type Expect<T extends true> = T;

// Both the basic (admin-only) and organization-extended auth instances must be
// usable through the public guard client contract. A weak all-optional
// GuardSessionShape regresses the basic check to false ("no properties in common").
type BasicOk = BasicAuth extends SessionAuthClient<GuardSessionShape, GuardUserShape> ? true : false;
type OrgOk = OrgAuth extends SessionAuthClient<GuardSessionShape, GuardUserShape> ? true : false;
type _BasicGuard = Expect<BasicOk>;
type _OrgGuard = Expect<OrgOk>;

// Precise fields are preserved: the basic session has no organization field,
// while the org session exposes activeOrganizationId.
type BasicSession = BasicAuth["$Infer"]["Session"]["session"];
type OrgSession = OrgAuth["$Infer"]["Session"]["session"];
type _BasicNoOrg = Expect<"activeOrganizationId" extends keyof BasicSession ? false : true>;
type _OrgHasOrg = Expect<"activeOrganizationId" extends keyof OrgSession ? true : false>;

export {};
