# @sunpcm/niu-utils

Framework-free formatting helpers for the Nexty platform. The package ships
ESM JavaScript and `.d.ts` files for Node 24, has no runtime dependencies, and
its root import reads no environment variables, opens no connections, and has
no initialization side effects.

## Install and build

```bash
pnpm add @sunpcm/niu-utils
pnpm --filter @sunpcm/niu-utils build
```

`pnpm build` writes `dist/index.js` and `dist/index.d.ts` with an independent
TypeScript configuration. The `src` TypeScript file is not a public entry.

## API

```ts
import {
  formatBytes,
  formatCurrency,
  formatValue,
  kebabToPascalCase,
} from "@sunpcm/niu-utils";
```

### `kebabToPascalCase(str: string): string`

Capitalizes each dash-separated word and removes the dashes. Empty strings and
strings without dashes retain their other characters, for example
`kebabToPascalCase("foo-bar-baz") === "FooBarBaz"`.

### `formatCurrency(amount, currency, defaultCurrency = "usd"): string`

`amount` is a **major-unit decimal number**, not integer cents. The locale is
fixed to `en-US`; the effective currency is `currency || defaultCurrency`,
uppercased for `Intl.NumberFormat`. Returns `"-"` for `null`, `undefined`, or
`NaN`. An invalid currency code falls back to `"<amount with 2 decimals> <CODE>"`
without logging or throwing. Examples: `formatCurrency(12.34, null)` is
`"$12.34"`, and `formatCurrency(12.34, "eur")` is `"€12.34"`.

Cents and locale-aware formatting remain application responsibilities; use
`formatCents` / `formatCurrency` in `apps/web/src/lib/format.ts` for those
cases. This package does not duplicate that API.

### `formatBytes(bytes: number, decimals = 2): string`

`bytes` is a signed count of bytes; the output uses binary units
(`Bytes`, `KB`, `MB`, `GB`, `TB`, `PB`, `EB`, `ZB`, `YB`) with 1024 as the
base. Zero returns `"0 Bytes"`. `decimals` is clamped to an integer in `[0, 100]`.
Negative values retain their sign, and values beyond `YB` remain in `YB`
instead of producing `undefined`. Non-finite values return `"0 Bytes"`.

### `formatValue(value: number | string, unit: "count" | "revenue"): string`

For `"revenue"`, `value` is converted to a number and formatted as USD with
the fixed `en-US` locale: `formatValue(12.34, "revenue") === "$12.34"`. For
`"count"`, numbers use `en-US` grouping; strings are returned unchanged.

## Compatibility and migration

- The former `@niu/utils` root exported `cn` in addition to the four helpers
  above. Class-name merging belongs to `@sunpcm/niu-ui`; import it from
  `@sunpcm/niu-ui/cn`. Applications that still use `apps/web/src/lib/utils.ts`
  keep their local `cn` until integration.
- The former package had a TS source entry, an unnecessary React peer, and
  `clsx` / `tailwind-merge` dependencies. Candidate consumers must install
  `@sunpcm/niu-utils` and use its built ESM entry. The old unscoped name is an
  unresolved workspace symlink until integration updates app manifests and
  lockfile.
- `formatValue` count formatting is now fixed to `en-US` for numbers. The old
  implementation used the process default locale and did not convert numeric
  strings. Other locale handling belongs to the application formatting module.

## Known P2 boundaries

These inputs retain documented behavior and are not expanded into a general
Intl compatibility layer in this unit:

- `formatCurrency` does not normalize arbitrary locale tags, unknown currency
  aliases, or all `Intl` fallback rules. Non-finite `Infinity` amounts are
  delegated to `Intl.NumberFormat`; invalid currency codes use amount.toFixed(2).
- `formatValue(value, "count")` returns numeric strings verbatim and does not
  parse them as counts. Non-numeric values passed to revenue produce the
  platform `Intl` result for `NaN`.
- `formatBytes` accepts very large `decimals` by clamping, and clamps the unit
  at `YB`; it does not add SI units or exact big-integer byte arithmetic.

See `NOTICE` for source provenance before redistribution.
