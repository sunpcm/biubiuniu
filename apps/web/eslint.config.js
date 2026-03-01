 
module.exports = [
  {
    ignores: ["**/dist/**", "**/.turbo/**", "**/.next/**", "**/node_modules/**"],
  },
  ...require("@niu/eslint-config"),
];
