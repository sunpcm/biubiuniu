import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prettierPackageDir = path.join(root, "packages/configs/prettier-config");
const prettierPackageName = "@sunpcm/niu-prettier-config";
const pnpmExecutable = process.env.ENGINEERING_PNPM_EXECUTABLE?.trim() || "pnpm";
const tarExecutable = process.env.ENGINEERING_TAR_EXECUTABLE?.trim() || "tar";
const scratchMarkerKind = "nexty-engineering-scratch-v1";
const stableBuildEnvironment = Object.freeze({
  DISABLE_AI: "true",
  DISABLE_NANO: "true",
  DISABLE_PURCHASE: "true",
  NANO_DISPATCH_BATCH_SIZE: "10",
  NANO_LEASE_MS: "180000",
  NANO_MAX_CONCURRENT_DISPATCHES: "4",
  NANO_MODEL: "gemini-2.5-flash-image-preview",
  NANO_POLL_INTERVAL_MS: "5000",
  NANO_PROVIDER_TIMEOUT_MS: "120000",
  NEXT_PUBLIC_SITE_URL: "https://engineering.n1.invalid",
  RESEND_API_KEY: ["queue", "secret", "stable"].join("-"),
});
const hashedBuildEnvironmentOverrides = Object.freeze([
  ["DISABLE_AI", "false"],
  ["DISABLE_NANO", "false"],
  ["DISABLE_PURCHASE", "false"],
  ["NANO_DISPATCH_BATCH_SIZE", "20"],
  ["NANO_LEASE_MS", "240000"],
  ["NANO_MAX_CONCURRENT_DISPATCHES", "8"],
  ["NANO_MODEL", "gemini-2.5-flash-image-preview-alt"],
  ["NANO_POLL_INTERVAL_MS", "10000"],
  ["NANO_PROVIDER_TIMEOUT_MS", "30000"],
  ["NANO_UNKNOWN_REFUND_AFTER_MS", "600000"],
]);

function commandEnv(overrides = {}) {
  const next = {};
  for (const key of [
    "HOME",
    "USERPROFILE",
    "TMPDIR",
    "TEMP",
    "TMP",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "TERM",
    "SystemRoot",
    "SYSTEMROOT",
    "ComSpec",
    "COMSPEC",
    "PATHEXT",
  ]) {
    if (process.env[key]) next[key] = process.env[key];
  }
  next.PATH = [path.dirname(process.execPath), process.env.PATH]
    .filter(Boolean)
    .join(path.delimiter);
  next.HUSKY = "0";
  next.CI = "1";
  next.NO_COLOR = "1";
  next.TURBO_TELEMETRY_DISABLED = "1";
  return Object.assign(next, overrides);
}

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd ?? root,
    env: commandEnv(options.env),
    maxBuffer: 20 * 1024 * 1024,
  });
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function collectPackageJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  const result = [];
  const skip = new Set([".git", ".next", ".turbo", "coverage", "dist", "node_modules"]);
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await collectPackageJsonFiles(entryPath)));
    if (entry.isFile() && entry.name === "package.json") result.push(entryPath);
  }
  return result;
}

async function checkIgnored(relativePath) {
  try {
    await run("git", ["check-ignore", "--no-index", "-q", relativePath]);
    return true;
  } catch (error) {
    if (error.code === 1) return false;
    throw error;
  }
}

async function buildDryRun(buildEnvironment) {
  assert.equal(
    Object.getPrototypeOf(buildEnvironment),
    Object.prototype,
    "every hash comparison must receive a complete explicit environment object",
  );
  const result = await run(
    pnpmExecutable,
    ["exec", "turbo", "run", "build", "--filter=@niu/web", "--dry=json"],
    { env: buildEnvironment },
  );
  const payload = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
  const webTask = payload.tasks.find((task) => task.taskId === "@niu/web#build");
  assert.ok(webTask, "Turbo dry-run must include @niu/web#build");
  return { raw: `${result.stdout}\n${result.stderr}`, webTask };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function assertSerialSourceMutation(relativePath, buildEnvironment) {
  const target = path.join(root, relativePath);
  const original = await fs.readFile(target);
  const originalStats = await fs.stat(target);
  const originalDigest = sha256(original);
  let initial;
  let changed;
  let operationError;
  let restoreError;

  try {
    initial = await buildDryRun(buildEnvironment);
    await fs.appendFile(target, Buffer.from("\n"));
    assert.notEqual(sha256(await fs.readFile(target)), originalDigest);
    changed = await buildDryRun(buildEnvironment);
  } catch (error) {
    operationError = error;
  } finally {
    try {
      await fs.writeFile(target, original);
      await fs.utimes(target, originalStats.atime, originalStats.mtime);
    } catch (error) {
      restoreError = error;
    }
  }

  const restoredContent = await fs.readFile(target);
  assert.equal(sha256(restoredContent), originalDigest, `${relativePath} bytes were not restored`);
  assert.equal(
    (await fs.stat(target)).mode,
    originalStats.mode,
    `${relativePath} mode was not restored`,
  );
  if (restoreError) throw restoreError;
  if (operationError) throw operationError;

  const restored = await buildDryRun(buildEnvironment);
  assert.notEqual(
    changed.webTask.hash,
    initial.webTask.hash,
    `${relativePath} change must alter the Turbo hash`,
  );
  assert.equal(
    restored.webTask.hash,
    initial.webTask.hash,
    `${relativePath} restoration must restore the original Turbo hash`,
  );
  console.log(
    `${relativePath}: ${initial.webTask.hash} -> ${changed.webTask.hash} -> ${restored.webTask.hash}`,
  );
}

function isEnabled(value) {
  return /^(?:1|true|yes)$/i.test(value ?? "");
}

async function createScratch(t) {
  const configuredRoot = process.env.ENGINEERING_TEST_SCRATCH_ROOT?.trim();
  const requestedRoot = configuredRoot ? path.resolve(configuredRoot) : os.tmpdir();
  await fs.mkdir(requestedRoot, { recursive: true });
  const base = await fs.realpath(requestedRoot);
  const scratchDir = await fs.mkdtemp(path.join(base, "nexty-engineering-"));
  const marker = {
    kind: scratchMarkerKind,
    id: randomUUID(),
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(scratchDir, ".owner.json"), `${JSON.stringify(marker)}\n`);

  t.after(async () => {
    if (isEnabled(process.env.ENGINEERING_KEEP_SCRATCH)) {
      console.log(`scratch retained: ${scratchDir}`);
      return;
    }
    assert.equal(path.dirname(scratchDir), base, "scratch must be a direct child of its root");
    const markerOnDisk = await readJson(path.join(scratchDir, ".owner.json"));
    assert.equal(markerOnDisk.kind, scratchMarkerKind, "scratch owner marker differs");
    assert.equal(markerOnDisk.id, marker.id, "scratch owner id differs");
    assert.equal(markerOnDisk.pid, process.pid, "scratch owner pid differs");
    const stats = await fs.lstat(scratchDir);
    assert.equal(stats.isDirectory(), true, "owned scratch must still be a directory");
    await fs.rm(scratchDir, { recursive: true, force: false });
  });

  return scratchDir;
}

function consumerInstallArguments() {
  const mode = process.env.ENGINEERING_PNPM_INSTALL_MODE?.trim() || "online";
  const modeArguments = {
    online: [],
    "prefer-offline": ["--prefer-offline"],
    offline: ["--offline"],
  };
  assert.ok(
    Object.hasOwn(modeArguments, mode),
    "ENGINEERING_PNPM_INSTALL_MODE must be online, prefer-offline, or offline",
  );

  const args = ["install", "--ignore-workspace", "--reporter=append-only", ...modeArguments[mode]];
  const storeDir = process.env.ENGINEERING_PNPM_STORE_DIR?.trim();
  if (storeDir) args.push("--store-dir", path.resolve(storeDir));
  return { args, mode, storeDir: storeDir ? path.resolve(storeDir) : null };
}

test("private package roots and environment file boundaries are enforced", async () => {
  const rootManifest = await readJson(path.join(root, "package.json"));
  assert.equal(rootManifest.private, true);
  assert.equal(rootManifest.packageManager, "pnpm@10.26.0");
  assert.equal(process.version, "v24.15.0");
  assert.equal((await run(pnpmExecutable, ["--version"])).stdout.trim(), "10.26.0");
  assert.match(rootManifest.engines.node, /24\.15\.0/);

  for (const rootName of ["apps", "fixtures", "templates"]) {
    for (const filePath of await collectPackageJsonFiles(path.join(root, rootName))) {
      assert.equal(
        (await readJson(filePath)).private,
        true,
        `${path.relative(root, filePath)} must be private`,
      );
    }
  }

  const releaseManifest = await readJson(path.join(root, "release/packages.json"));
  assert.equal(releaseManifest.schemaVersion, 1);
  assert.equal(releaseManifest.scope, "@sunpcm");
  assert.ok(Array.isArray(releaseManifest.packages));
  const allowlistedPaths = new Set();
  const allowlistedNames = new Set();
  for (const entry of releaseManifest.packages) {
    const resolvedDir = path.resolve(root, entry.path);
    const relativeDir = path.relative(root, resolvedDir).split(path.sep).join("/");
    assert.equal(
      relativeDir,
      entry.path,
      `${entry.path} must be a normalized repo-relative directory`,
    );
    assert.ok(
      relativeDir.startsWith("packages/") &&
        !relativeDir.includes("/../") &&
        !relativeDir.endsWith("/.."),
      `${entry.path} must stay under packages/ and cannot exempt root or apps`,
    );
    allowlistedPaths.add(relativeDir);
    allowlistedNames.add(entry.name);
    const filePath = path.join(resolvedDir, "package.json");
    assert.equal(existsSync(filePath), true, `${entry.path} must have a package.json`);
    const manifest = await readJson(filePath);
    assert.equal(manifest.name, entry.name, `${entry.path} manifest name must match allowlist`);
    assert.notEqual(manifest.private, true, `${entry.path} is allowlisted and must remain publishable`);
  }
  assert.equal(
    allowlistedPaths.size,
    releaseManifest.packages.length,
    "release allowlist must not contain duplicate paths",
  );
  assert.equal(
    allowlistedNames.size,
    releaseManifest.packages.length,
    "release allowlist must not contain duplicate names",
  );

  const workspacePackageFiles = new Set([path.join(root, "package.json")]);
  for (const workspaceRoot of ["apps", "fixtures", "templates", "packages"]) {
    for (const filePath of await collectPackageJsonFiles(path.join(root, workspaceRoot))) {
      workspacePackageFiles.add(filePath);
    }
  }
  for (const filePath of workspacePackageFiles) {
    const relativeDir = path.relative(root, path.dirname(filePath)).split(path.sep).join("/");
    const normalizedDir = relativeDir === "." ? "" : relativeDir;
    if (allowlistedPaths.has(normalizedDir)) continue;
    assert.equal(
      (await readJson(filePath)).private,
      true,
      `${path.relative(root, filePath)} is outside the release allowlist and must be private`,
    );
  }

  const workspace = await fs.readFile(path.join(root, "pnpm-workspace.yaml"), "utf8");
  assert.match(workspace, /^\s+- fixtures\/\*$/m);
  assert.match(workspace, /^\s+- templates\/\*$/m);

  for (const filePath of await collectPackageJsonFiles(root)) {
    const testScript = (await readJson(filePath)).scripts?.test;
    if (testScript) {
      assert.doesNotMatch(
        testScript,
        /\becho\b.*\bno tests\b/i,
        `${path.relative(root, filePath)} still has a placeholder test`,
      );
    }
  }

  assert.equal(await checkIgnored("apps/web/.env"), true);
  assert.equal(await checkIgnored("apps/web/.env.local"), true);
  assert.equal(await checkIgnored("apps/web/.env.production.local"), true);
  assert.equal(await checkIgnored("apps/web/.env.example"), false);
  assert.equal(await checkIgnored("apps/web/.env.production.example"), false);
});

test("Prettier package exposes an auditable release contract", async () => {
  const manifest = await readJson(path.join(prettierPackageDir, "package.json"));
  assert.equal(manifest.name, prettierPackageName);
  assert.equal(manifest.version, "0.1.0-next.0");
  assert.notEqual(manifest.private, true);
  assert.deepEqual(manifest.files, ["index.cjs"]);
  assert.deepEqual(manifest.exports, { ".": "./index.cjs" });
  assert.equal(manifest.publishConfig.registry, "https://npm.pkg.github.com");
  assert.equal(manifest.publishConfig.access, "restricted");
  assert.equal(manifest.peerDependencies.prettier, ">=3.5.1 <4");
  assert.equal(manifest.dependencies["prettier-plugin-tailwindcss"], "catalog:");
  assert.equal(manifest.devDependencies?.["prettier-plugin-tailwindcss"], undefined);
});

test("real tarball installs outside workspace and loads Tailwind sorting", async (t) => {
  const scratchDir = await createScratch(t);
  const artifactDir = path.join(scratchDir, "artifacts");
  const consumerDir = path.join(scratchDir, "consumer");
  await fs.mkdir(artifactDir);
  await fs.mkdir(consumerDir);

  await run(pnpmExecutable, [
    "--filter",
    prettierPackageName,
    "pack",
    "--pack-destination",
    artifactDir,
  ]);
  const tarballs = (await fs.readdir(artifactDir)).filter((file) => file.endsWith(".tgz"));
  assert.equal(tarballs.length, 1);
  const tarball = path.join(artifactDir, tarballs[0]);

  const entries = (await run(tarExecutable, ["-tzf", tarball])).stdout.trim().split("\n").sort();
  assert.deepEqual(entries, ["package/index.cjs", "package/package.json"]);

  const packedText = (await run(tarExecutable, ["-xOzf", tarball, "package/package.json"])).stdout;
  const packedManifest = JSON.parse(packedText);
  assert.equal(packedManifest.name, prettierPackageName);
  assert.equal(packedManifest.version, "0.1.0-next.0");
  assert.equal(packedManifest.dependencies["prettier-plugin-tailwindcss"], "0.7.2");
  assert.doesNotMatch(packedText, /\b(?:catalog|workspace|link|file):/);

  const packedConfig = (await run(tarExecutable, ["-xOzf", tarball, "package/index.cjs"])).stdout;
  assert.match(packedConfig, /prettier-plugin-tailwindcss/);
  assert.doesNotMatch(packedConfig, /packages\/configs\/prettier-config|workspace:|link:/);

  await fs.writeFile(
    path.join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "nexty-prettier-consumer-n1",
        version: "0.0.0",
        private: true,
        packageManager: "pnpm@10.26.0",
        prettier: prettierPackageName,
        devDependencies: {
          [prettierPackageName]: pathToFileURL(tarball).href,
          prettier: "3.8.0",
        },
      },
      null,
      2,
    )}\n`,
  );

  const inputPath = path.join(consumerDir, "input.html");
  const original =
    '<div class="text-red-500 flex items-center p-4 bg-white hover:bg-black"></div>\n';
  await fs.writeFile(inputPath, original);

  const install = consumerInstallArguments();
  await run(pnpmExecutable, install.args, { cwd: consumerDir });

  const installedDir = await fs.realpath(
    path.join(consumerDir, "node_modules", prettierPackageName),
  );
  assert.ok(installedDir.startsWith(`${consumerDir}${path.sep}`));

  const installedManifest = await readJson(path.join(installedDir, "package.json"));
  assert.equal(installedManifest.dependencies["prettier-plugin-tailwindcss"], "0.7.2");
  const configRequire = createRequire(path.join(installedDir, "package.json"));
  const pluginManifest = await fs.realpath(
    configRequire.resolve("prettier-plugin-tailwindcss/package.json"),
  );
  assert.ok(pluginManifest.startsWith(`${consumerDir}${path.sep}`));

  assert.doesNotMatch(
    await fs.readFile(path.join(installedDir, "index.cjs"), "utf8"),
    /packages\/configs\/prettier-config|workspace:|link:/,
  );

  await run(pnpmExecutable, ["exec", "prettier", "--write", "input.html"], {
    cwd: consumerDir,
  });
  const formatted = await fs.readFile(inputPath, "utf8");
  assert.notEqual(formatted, original, "Tailwind plugin must reorder class names");
  assert.deepEqual(
    formatted
      .match(/class="([^"]+)"/)?.[1]
      .split(/\s+/)
      .sort(),
    original
      .match(/class="([^"]+)"/)?.[1]
      .split(/\s+/)
      .sort(),
  );

  const artifact = {
    packageName: prettierPackageName,
    packageVersion: packedManifest.version,
    tarball,
    tarballSha256: sha256(await fs.readFile(tarball)),
    consumerDir,
    installedPlugin: pluginManifest,
    installMode: install.mode,
    storeDir: install.storeDir,
    formattedInput: formatted.trim(),
  };
  await fs.writeFile(
    path.join(scratchDir, "engineering-artifact.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
  console.log(`engineering scratch: ${scratchDir}`);
  console.log(`tarball: ${tarball}`);
  console.log(`tarball sha256: ${artifact.tarballSha256}`);
});

test("Turbo CLI hashes source, shared config, and build env without exposing secrets", async () => {
  const secretOne = ["queue", "secret", "one"].join("-");
  const secretTwo = ["queue", "secret", "two"].join("-");
  const secretUnchanged = ["queue", "secret", "unchanged"].join("-");
  const googleSecret = ["queue", "google", "secret"].join("-");
  const initial = await buildDryRun(stableBuildEnvironment);
  const repeated = await buildDryRun({
    ...stableBuildEnvironment,
    RESEND_API_KEY: secretTwo,
  });
  const googleKeyChanged = await buildDryRun({
    ...stableBuildEnvironment,
    GOOGLE_GENERATIVE_AI_API_KEY: googleSecret,
  });
  const publicEnvChanged = await buildDryRun({
    ...stableBuildEnvironment,
    NEXT_PUBLIC_SITE_URL: "https://changed.n1.invalid",
  });

  assert.equal(initial.webTask.hash, repeated.webTask.hash);
  assert.equal(initial.webTask.hash, googleKeyChanged.webTask.hash);
  assert.notEqual(initial.webTask.hash, publicEnvChanged.webTask.hash);
  assert.doesNotMatch(repeated.raw, /queue-secret-(?:one|two|unchanged)/);
  assert.doesNotMatch(googleKeyChanged.raw, new RegExp(googleSecret));
  assert.ok(initial.webTask.resolvedTaskDefinition.outputs.includes("!.next/cache/**"));

  for (const [name, changedValue] of hashedBuildEnvironmentOverrides) {
    const baselineValue = stableBuildEnvironment[name];
    assert.equal(
      typeof baselineValue,
      "string",
      `${name} must have an explicit baseline build environment value`,
    );
    assert.notEqual(baselineValue, changedValue, `${name} must have a distinct changed value`);
    const changedEnvironment = { ...stableBuildEnvironment, [name]: changedValue };
    const restoredEnvironment = { ...changedEnvironment, [name]: baselineValue };
    const changed = await buildDryRun(changedEnvironment);
    assert.notEqual(
      initial.webTask.hash,
      changed.webTask.hash,
      `${name} must alter the Turbo build hash`,
    );
    assert.equal(
      initial.webTask.hash,
      (await buildDryRun(restoredEnvironment)).webTask.hash,
      `restoring ${name} must restore the original Turbo build hash`,
    );
  }

  for (const relativePath of [
    "apps/web/src/proxy.ts",
    "apps/web/gtag.js",
    "apps/web/src/config/site.ts",
    "packages/configs/tailwind-config/theme.css",
  ]) {
    await assertSerialSourceMutation(relativePath, stableBuildEnvironment);
  }

  assert.equal(
    (
      await buildDryRun({
        ...stableBuildEnvironment,
        RESEND_API_KEY: secretUnchanged,
      })
    ).webTask.hash,
    initial.webTask.hash,
  );
});
