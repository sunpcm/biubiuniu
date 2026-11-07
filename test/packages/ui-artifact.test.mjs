import assert from "node:assert/strict";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const packageRoot = join(repositoryRoot, "packages", "ui");
const sourceRoot = join(packageRoot, "src");
const distRoot = join(packageRoot, "dist");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else {
      files.push(path);
    }
  }

  return files;
}

function isTypeScriptSourceArtifact(path) {
  return path.endsWith(".tsx") || (path.endsWith(".ts") && !path.endsWith(".d.ts"));
}

function readRuleDeclarations(css, selector) {
  const declarations = new Map();

  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = rule[1].split(",").map((value) => value.trim());
    if (!selectors.includes(selector)) continue;

    for (const declaration of rule[2].split(";")) {
      const separator = declaration.indexOf(":");
      if (separator === -1) continue;

      const property = declaration.slice(0, separator).trim();
      const value = declaration.slice(separator + 1).trim();
      if (property && value) declarations.set(property, value);
    }
  }

  return declarations;
}

function assertSemanticUtility(css, selector, property, expectedValue) {
  const values = [];

  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = rule[1].split(",").map((value) => value.trim());
    if (!selectors.includes(selector)) continue;

    for (const declaration of rule[2].split(";")) {
      const separator = declaration.indexOf(":");
      if (separator === -1) continue;

      if (declaration.slice(0, separator).trim() === property) {
        values.push(declaration.slice(separator + 1).trim());
      }
    }
  }

  assert.ok(
    values.some((value) => expectedValue(value)),
    `${selector} must resolve ${property} semantically`,
  );
}

test("package manifest publishes the explicit ESM, declaration, hook, and CSS contract", async () => {
  const packageJson = await readJson(join(packageRoot, "package.json"));

  assert.equal(packageJson.name, "@sunpcm/niu-ui");
  assert.equal(packageJson.version, "0.1.0-next.0");
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.main, "./dist/index.js");
  assert.equal(packageJson.types, "./dist/index.d.ts");
  assert.deepEqual(packageJson.exports["."], {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
  });
  assert.deepEqual(packageJson.exports["./components/*"], {
    types: "./dist/*.d.ts",
    import: "./dist/*.js",
  });
  assert.deepEqual(packageJson.exports["./cn"], {
    types: "./dist/cn.d.ts",
    import: "./dist/cn.js",
  });
  assert.deepEqual(packageJson.exports["./hooks/use-mobile"], {
    types: "./dist/hooks/use-mobile.d.ts",
    import: "./dist/hooks/use-mobile.js",
  });
  assert.equal(packageJson.exports["./styles.css"], "./styles.css");
  assert.deepEqual(packageJson.sideEffects, ["./styles.css"]);
  assert.equal(packageJson.publishConfig.registry, "https://npm.pkg.github.com");
  assert.equal(packageJson.publishConfig.access, "restricted");
  assert.ok(packageJson.files.includes("dist"));
  assert.ok(packageJson.files.includes("styles.css"));

  assert.equal(packageJson.dependencies["@niu/utils"], undefined);
  assert.equal(packageJson.dependencies.clsx, "catalog:");
  assert.equal(packageJson.dependencies["tailwind-merge"], "catalog:");
  assert.equal(packageJson.devDependencies["@tailwindcss/cli"], "^4.1.18");
  assert.equal(packageJson.devDependencies.tailwindcss, "catalog:");
  assert.equal(packageJson.peerDependencies.react, "catalog:");
  assert.equal(packageJson.peerDependencies["react-dom"], "catalog:");
  assert.equal(packageJson.devDependencies.react, "catalog:");
  assert.equal(packageJson.devDependencies["react-dom"], "catalog:");
  assert.equal(packageJson.devDependencies["@types/react-dom"], "catalog:");
  assert.equal(packageJson.peerDependencies.next, undefined);
  assert.equal(packageJson.peerDependencies["next-themes"], undefined);
});

test("source graph stays inside the package and uses Node-resolvable ESM specifiers", async () => {
  const sourceFiles = await listFiles(sourceRoot);
  const codeFiles = sourceFiles.filter((path) => [".ts", ".tsx"].includes(extname(path)));
  const descriptor = await readFile(join(packageRoot, "package.json"), "utf8");

  assert.doesNotMatch(descriptor, /"(?:next|next-themes|server-only|@niu\/utils)"/);
  assert.doesNotMatch(descriptor, /"@sunpcm\/niu-ui"\s*:\s*"workspace:/);

  for (const path of codeFiles) {
    const contents = await readFile(path, "utf8");
    assert.doesNotMatch(
      contents,
      /(?:from\s+|import\s+)["'](?:next(?:\/[^"']*)?|next-themes|server-only)["']/,
    );
    assert.doesNotMatch(contents, /from\s+["']@niu\/utils["']/);
    assert.doesNotMatch(contents, /from\s+["']@\//);

    const relativeSpecifiers = [...contents.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)];
    for (const match of relativeSpecifiers) {
      assert.match(
        match[1],
        /\.(?:js|css)$/,
        `${path} must use an explicit .js or .css extension for ${match[1]}`,
      );
    }
  }
});

test("artifact filename classifier accepts declarations and rejects TypeScript source", () => {
  assert.equal(isTypeScriptSourceArtifact("index.d.ts"), false);
  assert.equal(isTypeScriptSourceArtifact("index.ts"), true);
  assert.equal(isTypeScriptSourceArtifact("button.tsx"), true);
  assert.equal(isTypeScriptSourceArtifact("index.js"), false);
});

test("client boundaries are limited to source modules that declare them and survive the build", async () => {
  const sourceFiles = (await listFiles(sourceRoot)).filter((path) =>
    [".ts", ".tsx"].includes(extname(path)),
  );
  const clientSources = [];

  for (const path of sourceFiles) {
    const contents = await readFile(path, "utf8");
    if (contents.startsWith('"use client";')) {
      clientSources.push(path);
    }
  }

  assert.ok(clientSources.length > 0);

  for (const sourcePath of clientSources) {
    const relativePath = sourcePath.slice(sourceRoot.length + 1).replace(/\.tsx?$/, ".js");
    const outputPath = join(distRoot, relativePath);
    await access(outputPath);
    assert.match(await readFile(outputPath, "utf8"), /^"use client";/);
  }

  const toasterSource = await readFile(join(sourceRoot, "sonner.tsx"), "utf8");
  assert.doesNotMatch(toasterSource, /next-themes|useTheme/);
  assert.match(toasterSource, /theme\s*=\s*"system"/);

  const badgeSource = await readFile(join(sourceRoot, "badge-1.tsx"), "utf8");
  assert.doesNotMatch(badgeSource, /next\/link|import Link/);
  assert.match(badgeSource, /const LinkComponent = as \?\? "a"/);
});

test("the package emits importable ESM declarations and a framework-free root", async () => {
  for (const relativePath of [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/button.js",
    "dist/button.d.ts",
    "dist/cn.js",
    "dist/cn.d.ts",
    "dist/hooks/use-mobile.js",
    "dist/hooks/use-mobile.d.ts",
  ]) {
    const path = join(packageRoot, relativePath);
    await access(path);
    assert.ok((await stat(path)).size > 0, `${relativePath} is empty`);
  }

  const emittedFiles = await listFiles(distRoot);
  assert.equal(emittedFiles.some(isTypeScriptSourceArtifact), false);

  const rootOutput = await readFile(join(distRoot, "index.js"), "utf8");
  assert.doesNotMatch(rootOutput, /\.css["']/);
  const rootSpecifiers = [...rootOutput.matchAll(/from\s+["'](\.\/[^"']+)["']/g)];
  assert.ok(rootSpecifiers.length > 0);
  for (const match of rootSpecifiers) {
    assert.match(match[1], /\.js$/);
  }

  const ui = await import(pathToFileURL(join(distRoot, "index.js")).href);
  assert.equal(typeof ui.Button, "function");
  assert.equal(typeof ui.Card, "function");

  const { cn } = await import(pathToFileURL(join(distRoot, "cn.js")).href);
  assert.equal(cn("px-2", "px-4"), "px-4");
});

test("published CSS contains real theme tokens and component utilities without source directives", async () => {
  const css = await readFile(join(packageRoot, "styles.css"), "utf8");

  assert.ok(css.length > 10_000, "compiled CSS is unexpectedly small");
  assert.match(css, /\.inline-flex/);
  assert.match(css, /\.grid/);
  assert.match(css, /\.dark/);

  const rootTheme = readRuleDeclarations(css, ":root");
  const darkTheme = readRuleDeclarations(css, ".dark");

  for (const token of ["--background", "--primary", "--primary-foreground"]) {
    assert.match(
      rootTheme.get(token) ?? "",
      /(?:oklch|hsl|rgb)\(/,
      `${token} is missing from light theme`,
    );
    assert.match(
      darkTheme.get(token) ?? "",
      /(?:oklch|hsl|rgb)\(/,
      `${token} is missing from dark theme`,
    );
  }

  assert.notEqual(rootTheme.get("--primary"), darkTheme.get("--primary"));
  assert.notEqual(rootTheme.get("--primary-foreground"), darkTheme.get("--primary-foreground"));

  // Tailwind may inline --color-primary aliases and merge selectors, so verify
  // the emitted utility-to-token resolution rather than an intermediate name.
  assertSemanticUtility(
    css,
    ".bg-primary",
    "background-color",
    (value) => value === "var(--primary)",
  );
  assertSemanticUtility(
    css,
    ".bg-primary\\/20",
    "background-color",
    (value) => value === "var(--primary)",
  );
  assertSemanticUtility(css, ".bg-primary\\/20", "background-color", (value) =>
    /^color-mix\(.+var\(--primary\) 20%/.test(value),
  );
  assertSemanticUtility(
    css,
    ".text-primary-foreground",
    "color",
    (value) => value === "var(--primary-foreground)",
  );

  assert.doesNotMatch(css, /@(?:source|theme|utility|custom-variant|apply|plugin)\b/);
  assert.doesNotMatch(css, /@tailwind\b/);
  assert.doesNotMatch(css, /@import\s+["']tailwindcss["']/);
});
