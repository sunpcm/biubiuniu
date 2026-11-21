/* global require, module, __dirname, process */
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * ESLint v9 Flat Config preset for Next.js apps.
 *
 * Usage in apps/web/eslint.config.js:
 *   module.exports = [
 *     ...require("@niu/eslint-config"),
 *     ...require("@niu/eslint-config/next"),
 *     // app-specific overrides
 *   ];
 */

let nextFlatConfigs;
try {
  nextFlatConfigs = require("eslint-config-next/flat");
} catch {
  const { FlatCompat } = require("@eslint/eslintrc");
  const path = require("node:path");
  const compat = new FlatCompat({
    baseDirectory: path.resolve(__dirname),
  });
  nextFlatConfigs = compat.extends("next/core-web-vitals");
}

module.exports = [
  ...(Array.isArray(nextFlatConfigs) ? nextFlatConfigs : [nextFlatConfigs]),
  {
    rules: {
      "react-hooks/exhaustive-deps": process.env.NODE_ENV === "production" ? "off" : "warn",
      "react/no-unescaped-entities": "off",
      "@next/next/no-img-element": "off",
    },
  },
];
