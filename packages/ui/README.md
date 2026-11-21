# @sunpcm/niu-ui

Framework-independent React components, hooks, and theme assets extracted from
the Nexty web application.

## Installation

```bash
pnpm add @sunpcm/niu-ui react react-dom
```

React and React DOM are peer dependencies. The package does not install or
bundle Next.js, `next-themes`, server-only modules, database clients, or
provider SDKs.

## Imports

```tsx
import { Button, Card, CardContent } from "@sunpcm/niu-ui";
import { Badge as LegacyBadge } from "@sunpcm/niu-ui/components/badge-1";
import { cn } from "@sunpcm/niu-ui/cn";
import { useIsMobile } from "@sunpcm/niu-ui/hooks/use-mobile";
import "@sunpcm/niu-ui/styles.css";
```

The package root has no CSS, theme, network, or environment side effects.
Import `styles.css` once from the application entry or root layout.

## Vite and Tailwind CSS

`styles.css` is a precompiled Tailwind CSS v4 artifact containing the package
theme and the utilities referenced by the published components. A Vite
application can use it directly without configuring Tailwind to scan
`node_modules`:

```ts
import "@sunpcm/niu-ui/styles.css";
```

The source file is at `src/styles.css` and copies the current shared theme from
`packages/configs/tailwind-config/theme.css`. Keep those two files synchronized
until the application migrates to this package's theme entry. The source theme
is compiled into the published artifact, so consuming Vite projects do not need
an absolute or same-repository `@source` path.

If an application compiles package source itself, use
`@sunpcm/niu-ui/components/*` and include the installed component JavaScript in
its own Tailwind content scan. Directly importing `styles.css` is the supported
path that does not depend on consumer Tailwind configuration.

## Theme injection

`Toaster` accepts the normal Sonner `theme` prop:

```tsx
<Toaster theme="system" richColors />
```

The application owns theme resolution. If it already has a resolved
`light`/`dark` value, pass that explicitly. Omitting `theme` falls back to
`"system"`. This replaces the previous implicit `next-themes` dependency.

## Link semantics

The legacy `Badge` in `components/badge-1` renders a safe standard `<a>` when
`href` is provided. Applications can inject a framework link component through
`as`, for example a Next.js `Link`, without making Next a dependency of this
package.

## Build

```bash
pnpm build
```

The build emits ESM JavaScript and declarations into `dist` and compiles
`src/styles.css` into the published `styles.css`.
