import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const packageRoot = join(repositoryRoot, "packages", "utils");
const distRoot = join(packageRoot, "dist");

function distUrl() {
  return pathToFileURL(join(distRoot, "index.js")).href;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("manifest publishes a Node ESM and declaration root with no runtime dependencies", async () => {
  const manifest = await readJson(join(packageRoot, "package.json"));

  assert.equal(manifest.name, "@sunpcm/niu-utils");
  assert.equal(manifest.version, "0.1.0-next.0");
  assert.equal(manifest.type, "module");
  assert.equal(manifest.main, "./dist/index.js");
  assert.equal(manifest.types, "./dist/index.d.ts");
  assert.deepEqual(manifest.exports["."], {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
  });
  assert.equal(manifest.sideEffects, false);
  assert.deepEqual(manifest.files, ["dist", "README.md", "NOTICE"]);
  assert.equal(manifest.publishConfig.registry, "https://npm.pkg.github.com");
  assert.equal(manifest.publishConfig.access, "restricted");
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.peerDependencies, undefined);
  assert.equal(manifest.scripts.build, "tsc -p tsconfig.build.json");

  const tsconfig = await readJson(join(packageRoot, "tsconfig.build.json"));
  assert.equal(tsconfig.compilerOptions.declaration, true);
  assert.equal(tsconfig.compilerOptions.outDir, "./dist");
  assert.equal(tsconfig.compilerOptions.rootDir, "./src");

  const descriptor = await readFile(join(packageRoot, "package.json"), "utf8");
  assert.doesNotMatch(descriptor, /"@niu\/utils"|workspace:\*|catalog:/);
  assert.doesNotMatch(descriptor, /\/Users\/|\/private\//);
});

test("source and build descriptor stay framework-free and free of initialization side effects", async () => {
  const source = await readFile(join(packageRoot, "src", "index.ts"), "utf8");
  const tsconfig = await readJson(join(packageRoot, "tsconfig.json"));

  assert.equal(tsconfig.compilerOptions.module, "NodeNext");
  assert.equal(tsconfig.compilerOptions.moduleResolution, "NodeNext");
  assert.equal(tsconfig.compilerOptions.lib.includes("DOM"), false);
  assert.doesNotMatch(source, /process\.env|fetch\(|console\.|new Client|createPool|@niu|@\/|from ["'](?:react|next|clsx|tailwind-merge)/);
  assert.doesNotMatch(source, /export function cn|from ["']\./);
  assert.match(source, /export function kebabToPascalCase/);
  assert.match(source, /export const formatCurrency/);
  assert.match(source, /export function formatBytes/);
  assert.match(source, /export function formatValue/);
});

test("built ESM and declarations exist, contain no source references, and have four exports", async () => {
  for (const relativePath of ["dist/index.js", "dist/index.d.ts", "dist/index.d.ts.map"]) {
    const path = join(packageRoot, relativePath);
    await access(path);
    assert.ok((await stat(path)).size > 0, `${relativePath} is empty`);
  }

  const output = await readFile(join(distRoot, "index.js"), "utf8");
  const declaration = await readFile(join(distRoot, "index.d.ts"), "utf8");
  assert.doesNotMatch(output, /src\/index\.ts|\.ts["']/);
  assert.doesNotMatch(declaration, /src\/index\.ts/);
  assert.match(declaration, /kebabToPascalCase/);
  assert.match(declaration, /formatCurrency/);
  assert.match(declaration, /formatBytes/);
  assert.match(declaration, /formatValue/);

  const utils = await import(distUrl());
  assert.deepEqual(Object.keys(utils).sort(), [
    "formatBytes",
    "formatCurrency",
    "formatValue",
    "kebabToPascalCase",
  ]);
  assert.equal(utils.cn, undefined);
});

test("root import works in a permission-restricted Node process without framework modules", async () => {
  const script = `
    const utils = await import("@sunpcm/niu-utils");
    if (process.env.NEXT_PUBLIC_DEFAULT_CURRENCY !== "jpy") {
      throw new Error("probe environment missing");
    }
    if (utils.formatCurrency(12.34, null) !== "$12.34") {
      throw new Error("root import read the wrong currency source");
    }
    console.log("ROOT_IMPORT_OK");
  `;
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    "--permission",
    `--allow-fs-read=${packageRoot}`,
    "--input-type=module",
    "-e",
    script,
  ], {
    cwd: packageRoot,
    env: { ...process.env, NEXT_PUBLIC_DEFAULT_CURRENCY: "jpy" },
  });

  assert.match(stdout, /ROOT_IMPORT_OK/);
  assert.equal(stderr, "");
});

test("kebabToPascalCase preserves the existing capitalization semantics", async () => {
  const { kebabToPascalCase } = await import(distUrl());

  assert.equal(kebabToPascalCase("foo-bar-baz"), "FooBarBaz");
  assert.equal(kebabToPascalCase("button"), "Button");
  assert.equal(kebabToPascalCase(""), "");
  assert.equal(kebabToPascalCase("alreadyPascal"), "AlreadyPascal");
});

test("formatCurrency keeps null fallback, fixed en-US locale, and invalid-code fallback", async () => {
  const { formatCurrency } = await import(distUrl());

  assert.equal(formatCurrency(null, null), "-");
  assert.equal(formatCurrency(undefined, "eur"), "-");
  assert.equal(formatCurrency(Number.NaN, "eur"), "-");
  assert.equal(formatCurrency(12.34, null), "$12.34");
  assert.equal(formatCurrency(12.34, "eur"), "€12.34");
  assert.equal(formatCurrency(12.34, null, "gbp"), "£12.34");
  assert.equal(formatCurrency(0, "usd"), "$0.00");
  assert.equal(formatCurrency(12.34, "not-a-currency"), "12.34 NOT-A-CURRENCY");
});

test("formatBytes preserves ordinary units and fixes reproducible boundary failures", async () => {
  const { formatBytes } = await import(distUrl());

  assert.equal(formatBytes(0), "0 Bytes");
  assert.equal(formatBytes(1024), "1 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1536, 0), "2 KB");
  assert.equal(formatBytes(-1536), "-1.5 KB");
  assert.equal(formatBytes(0.5), "0.5 Bytes");
  assert.equal(formatBytes(-0.5), "-0.5 Bytes");
  assert.equal(formatBytes(1024 ** 9), "1024 YB");
  assert.equal(formatBytes(Number.POSITIVE_INFINITY), "0 Bytes");
  assert.equal(formatBytes(Number.NaN), "0 Bytes");
  assert.equal(formatBytes(1024, 101), "1 KB");
  assert.equal(formatBytes(1024, -1), "1 KB");
});

test("formatValue keeps revenue, en-US count, and string-count behavior", async () => {
  const { formatValue } = await import(distUrl());

  assert.equal(formatValue(12.34, "revenue"), "$12.34");
  assert.equal(formatValue("12.34", "revenue"), "$12.34");
  assert.equal(formatValue(1234.5, "count"), "1,234.5");
  assert.equal(formatValue("00123", "count"), "00123");
});

test("README documents API, units, locale, artifacts, and migration", async () => {
  const readme = await readFile(join(packageRoot, "README.md"), "utf8");

  for (const phrase of [
    "ESM JavaScript",
    "major-unit decimal number",
    "en-US",
    "integer cents",
    "@sunpcm/niu-ui/cn",
    "Known P2 boundaries",
    "dist/index.d.ts",
  ]) {
    assert.match(readme, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
