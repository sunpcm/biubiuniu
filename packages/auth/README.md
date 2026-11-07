# @sunpcm/niu-auth

Better Auth configuration factory and auth domain rules extracted from the
Nexty reference application. The root entry is plain Node ESM: no Next.js,
React, Drizzle, or PostgreSQL import. Better Auth's database adapter and all
environment/site/provider/mail/reward/Redis/clock/request-signal concerns are
injected by the composition layer.

## Install

```bash
pnpm add @sunpcm/niu-auth better-auth
```

`better-auth` is a required peer dependency. `react` is an optional peer
dependency needed only by the `/client` subpath; a plain Node server consumer
does not install React. The package does not bundle Next.js, Drizzle,
PostgreSQL, provider SDKs, or a database client.

## Imports

```ts
import { createAuth, createServerGuards, isBanActive } from "@sunpcm/niu-auth";
import { createAuthClientInstance } from "@sunpcm/niu-auth/client";
```

The `/client` subpath is the only entry that imports React.

## Composition

`createAuth` takes every environment/site/provider/mail/reward/Redis/clock/
request-signal concern as an explicit dependency and never reads `process.env`.
The following are enforced at assembly:

- `secret` must be a non-empty string.
- `baseURL` defaults to `site.url` when omitted.
- `billing` is required and must be `null` when billing is disabled. The
  `organization` and `billing` capabilities reject a missing billing port; the
  `organization` plugin additionally requires `mail.sendOrganizationInvitation`.
- `magicLink` / `emailOTP` require `mail.sendMagicLink` /
  `mail.sendVerificationOtp` respectively.
- `site` and `capabilities` are snapshotted per instance.

The `AuthPolicyStore` only covers identity/member/invitation reads. Billing
queries (`AuthBillingPort`) are injected separately and never imported from the
Commerce implementation.
