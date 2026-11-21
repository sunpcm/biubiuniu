# @sunpcm/niu-next

Next.js server/client adapters for `@sunpcm/niu-auth`. The server entry wires
`nextCookies`, `next/headers`, `next/navigation` and `React.cache`; all permission
decisions remain in `@sunpcm/niu-auth` (fresh state every call).

## Install

```bash
pnpm add @sunpcm/niu-next @sunpcm/niu-auth better-auth next react
```

## Imports

```ts
import {
  createNextAuthPlugins,
  createNextServerGuards,
  createNextRequestSignal,
  toNextJsHandler,
} from "@sunpcm/niu-next";
```

The server root does not export client code; `@sunpcm/niu-next/client` is a
thin alias for the React client in `@sunpcm/niu-auth/client`.
