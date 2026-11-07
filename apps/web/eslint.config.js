import eslintConfig from "@niu/eslint-config";

export default [
  {
    ignores: ["**/dist/**", "**/.turbo/**", "**/.next/**", "**/node_modules/**"],
  },
  ...eslintConfig,
];
