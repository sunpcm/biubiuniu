import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const nanoPkg = join(repoRoot, "packages", "feature-nano");
const typescript = createRequire(join(nanoPkg, "package.json"))("typescript");
const forbiddenRoots = new Set([
  "react",
  "react-dom",
  "next",
  "@google/genai",
  "server-only",
  "drizzle-orm",
  "postgres",
]);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function isForbiddenSpecifier(specifier) {
  return [...forbiddenRoots].some(
    (root) => specifier === root || specifier.startsWith(`${root}/`),
  );
}

function stringLiteralValue(node) {
  if (node && typescript.isStringLiteral(node)) return node.text;
  return null;
}

function analyzeSource(source, fileName) {
  const sourceFile = typescript.createSourceFile(
    fileName,
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.JS,
  );
  const moduleSpecifiers = [];
  const envAccesses = [];

  function recordModuleSpecifier(node) {
    const specifier = stringLiteralValue(node);
    if (specifier !== null) moduleSpecifiers.push(specifier);
  }

  function isProcessIdentifier(node) {
    return Boolean(node) && typescript.isIdentifier(node) && node.text === "process";
  }

  function visit(node) {
    if (
      typescript.isImportDeclaration(node) ||
      typescript.isExportDeclaration(node)
    ) {
      recordModuleSpecifier(node.moduleSpecifier);
    } else if (
      typescript.isImportEqualsDeclaration(node) &&
      typescript.isExternalModuleReference(node.moduleReference)
    ) {
      recordModuleSpecifier(node.moduleReference.expression);
    } else if (typescript.isImportTypeNode(node)) {
      const argument = node.argument;
      if (typescript.isLiteralTypeNode(argument)) {
        recordModuleSpecifier(argument.literal);
      }
    } else if (typescript.isCallExpression(node)) {
      const dynamicImport =
        node.expression.kind === typescript.SyntaxKind.ImportKeyword;
      const requireCall =
        typescript.isIdentifier(node.expression) &&
        node.expression.text === "require";
      if (
        (dynamicImport || requireCall) &&
        node.arguments.length > 0 &&
        typescript.isStringLiteral(node.arguments[0])
      ) {
        moduleSpecifiers.push(node.arguments[0].text);
      }
    }

    if (
      typescript.isPropertyAccessExpression(node) &&
      node.name.text === "env" &&
      isProcessIdentifier(node.expression)
    ) {
      envAccesses.push(node.getText(sourceFile));
    } else if (
      typescript.isElementAccessExpression(node) &&
      isProcessIdentifier(node.expression) &&
      node.argumentExpression &&
      typescript.isStringLiteral(node.argumentExpression) &&
      node.argumentExpression.text === "env"
    ) {
      envAccesses.push(node.getText(sourceFile));
    } else if (
      typescript.isVariableDeclaration(node) &&
      isProcessIdentifier(node.initializer) &&
      typescript.isObjectBindingPattern(node.name)
    ) {
      for (const element of node.name.elements) {
        if (
          typescript.isIdentifier(element.name) &&
          element.name.text === "env" &&
          (!element.propertyName ||
            (typescript.isIdentifier(element.propertyName) &&
              element.propertyName.text === "env"))
        ) {
          envAccesses.push(element.getText(sourceFile));
        }
      }
    }

    typescript.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { moduleSpecifiers, envAccesses };
}

test("boundary analyzer distinguishes real references from comments and strings", () => {
  const inert = analyzeSource(
    `
      // import "@google/genai"; const value = process.env;
      export const note = "process.env and next/server";
    `,
    "inert.js",
  );
  assert.deepEqual(inert.moduleSpecifiers, []);
  assert.deepEqual(inert.envAccesses, []);

  const active = analyzeSource(
    `
      import "@google/genai";
      export { default as next } from "next/server";
      const required = require("drizzle-orm");
      const environment = process.env;
    `,
    "active.js",
  );
  assert.deepEqual(
    active.moduleSpecifiers.filter(isForbiddenSpecifier),
    ["@google/genai", "next/server", "drizzle-orm"],
  );
  assert.deepEqual(active.envAccesses, ["process.env"]);
});

test("boundary analyzer tolerates uninitialized declarations without losing env detection", () => {
  const analysis = analyzeSource(
    `
      let pending;
      for (const chunk of stream) {
        consume(chunk);
      }
      const { env } = process;
    `,
    "uninitialized.js",
  );
  assert.deepEqual(analysis.moduleSpecifiers, []);
  assert.deepEqual(analysis.envAccesses, ["env"]);
});

test("manifest exposes core, google provider, and react subpaths only", async () => {
  const pkg = await readJson(join(nanoPkg, "package.json"));
  assert.equal(pkg.name, "@sunpcm/niu-feature-nano");
  assert.equal(pkg.type, "module");
  assert.deepEqual(Object.keys(pkg.exports).sort(), [
    ".",
    "./package.json",
    "./provider/google",
    "./react",
  ]);
  assert.equal(pkg.peerDependenciesMeta["@google/genai"].optional, true);
  assert.equal(pkg.peerDependenciesMeta.react.optional, true);
});

test("core root dist never imports React, Next, Google, or env", async () => {
  const files = [
    "index.js",
    "core.js",
    "errors.js",
    "provider.js",
    "case-catalog.js",
  ];
  for (const file of files) {
    const src = await readFile(join(nanoPkg, "dist", file), "utf8");
    const analysis = analyzeSource(src, file);
    const forbidden = analysis.moduleSpecifiers.filter(isForbiddenSpecifier);
    assert.deepEqual(forbidden, [], `${file} must not import framework/SDK`);
    assert.deepEqual(analysis.envAccesses, [], `${file} must not access env`);
  }
});

test("google subpath is the only entry importing @google/genai", async () => {
  const google = await readFile(join(nanoPkg, "dist", "provider", "google.js"), "utf8");
  assert.ok(
    analyzeSource(google, "provider/google.js").moduleSpecifiers.includes(
      "@google/genai",
    ),
  );
  const root = await readFile(join(nanoPkg, "dist", "index.js"), "utf8");
  assert.equal(
    analyzeSource(root, "index.js").moduleSpecifiers.includes("@google/genai"),
    false,
  );
});
