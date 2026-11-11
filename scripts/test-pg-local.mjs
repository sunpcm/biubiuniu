import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { dirname, delimiter, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const role = "nexty_overnight_test";
const image = "postgres:16-alpine";
const prefix = "nexty_overnight_20261105_";
const names = Object.freeze({
  app: `${prefix}n4_app`,
  reference: `${prefix}test`,
  migration: `${prefix}migration_c01`,
  fault: `${prefix}migration_fault_c01`,
  auth: `${prefix}n3_auth`,
  credits: `${prefix}n3_auth_credits`,
  commerce: `${prefix}n3_commerce`,
  foreign: `${prefix}n3_commerce_foreign`,
  profiles: `${prefix}n3_profiles`,
});

function processEnvironment(source = process.env) {
  const env = {};
  for (const key of [
    "HOME",
    "USERPROFILE",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SystemRoot",
    "SYSTEMROOT",
    "ComSpec",
    "COMSPEC",
    "PATHEXT",
  ])
    if (source[key]) env[key] = source[key];
  env.PATH = [dirname(process.execPath), source.PATH].filter(Boolean).join(delimiter);
  return {
    ...env,
    HUSKY: "0",
    NEXT_TELEMETRY_DISABLED: "1",
    TURBO_TELEMETRY_DISABLED: "1",
    NO_COLOR: "1",
  };
}

/** Only newly generated connections enter the test processes; no .env is read. */
export function syntheticEnvironment(port, password, source = process.env) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid synthetic PG port");
  const url = (name) =>
    `postgresql://${role}:${encodeURIComponent(password)}@127.0.0.1:${port}/${name}`;
  return {
    ...processEnvironment(source),
    BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
    NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000",
    NEXT_PUBLIC_BETTER_AUTH_URL: "http://127.0.0.1:3000",
    DISABLE_AI: "true",
    DISABLE_NANO: "true",
    DISABLE_PURCHASE: "true",
    TSX_TSCONFIG_PATH: "test/domain/tsconfig.json",
    DATABASE_URL: url(names.app),
    DOMAIN_TEST_EXPECTED_DATABASE: names.app,
    DOMAIN_TEST_EXPECTED_PORT: String(port),
    N2_REFERENCE_DATABASE_URL: url(names.reference),
    MIGRATION_C01_DATABASE_URL: url(names.migration),
    MIGRATION_FAULT_DATABASE_URL: url(names.fault),
    AUTH_PG_TEST_URL: url(names.auth),
    AUTH_PG_TEST_DB: names.auth,
    AUTH_CREDITS_PG_TEST_URL: url(names.credits),
    AUTH_CREDITS_PG_TEST_DB: names.credits,
    COMMERCE_PG_DATABASE_URL: url(names.commerce),
    COMMERCE_PG_FOREIGN_DATABASE_URL: url(names.foreign),
    COMMERCE_PG_EXPECTED_DATABASE: names.commerce,
    COMMERCE_PG_EXPECTED_ROLE: role,
    PG_PROFILES_TEST_URL: url(names.profiles),
    PG_PROFILES_TEST_EXPECTED_DATABASE: names.profiles,
    PG_PROFILES_TEST_EXPECTED_ROLE: role,
  };
}

export function assertLocalDockerEndpoint(endpoint) {
  if (!/^(unix:\/\/\/|npipe:\/\/)/.test(endpoint))
    throw new Error("Only a local Docker socket is allowed; remote Docker daemons are refused");
}

export function assertZeroSkips(tap) {
  const skipped = [...tap.matchAll(/^# skipped (\d+)\s*$/gm)];
  const tests = [...tap.matchAll(/^# tests (\d+)\s*$/gm)];
  if (skipped.length !== 1 || tests.length !== 1 || Number(tests[0][1]) === 0)
    throw new Error("Missing or ambiguous Node test summary");
  if (Number(skipped[0][1]) !== 0 || /^\s*(?:not )?ok .*# SKIP/im.test(tap))
    throw new Error("PG test suite contains skips");
  if (/^# (?:fail|cancelled|todo) [1-9]\d*\s*$/m.test(tap))
    throw new Error("PG test suite has failures, cancellations or TODOs");
}

/** Keep failure propagation and owned-container cleanup in one lifecycle. */
export async function main() {
  if (process.version !== "v24.15.0") throw new Error("Node v24.15.0 is required");
  const hostEnv = processEnvironment();
  // These select the local daemon only; they never enter test processes.
  for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT"])
    if (process.env[key]) hostEnv[key] = process.env[key];
  let activeChild;
  let interrupted = false;
  const stop = () => {
    interrupted = true;
    activeChild?.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  async function execute(command, args, { env = hostEnv, quiet = false, cleanup = false } = {}) {
    if (interrupted && !cleanup) throw new Error("Local PG run interrupted");
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
      activeChild = child;
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (!quiet) process.stdout.write(chunk);
      });
      child.stderr.on("data", (chunk) => {
        if (!quiet) process.stderr.write(chunk);
      });
      child.on("error", reject);
      child.on("close", (code, signal) => {
        if (activeChild === child) activeChild = undefined;
        if (code === 0) resolve(output.trim());
        else reject(new Error(`${command} failed: ${signal ?? code}`));
      });
    });
  }

  const owner = randomUUID();
  const container = `nexty-pg-local-${owner}`;
  let creationAttempted = false;
  try {
    const pnpmVersion = await execute("pnpm", ["--version"], { quiet: true });
    if (pnpmVersion !== "10.26.0") throw new Error("pnpm 10.26.0 is required");
    const endpoint =
      hostEnv.DOCKER_HOST ||
      (await execute("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], {
        quiet: true,
      }));
    assertLocalDockerEndpoint(endpoint);
    // Never contact a registry implicitly. Provision the image beforehand.
    await execute("docker", ["image", "inspect", image], { quiet: true });
    const password = randomBytes(24).toString("hex");
    creationAttempted = true;
    await execute(
      "docker",
      [
        "run",
        "--rm",
        "-d",
        "--pull=never",
        "--name",
        container,
        "--label",
        `nexty.pg-local.owner=${owner}`,
        "--tmpfs",
        "/var/lib/postgresql/data:rw",
        "-e",
        `POSTGRES_USER=${role}`,
        "-e",
        `POSTGRES_PASSWORD=${password}`,
        "-p",
        "127.0.0.1::5432",
        image,
      ],
      { quiet: true },
    );
    console.log(`[PG local] Created ${container}; temporary data, loopback port only`);
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        // Initialization has a transient Unix-socket server: require final TCP readiness.
        await execute("docker", ["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", role], {
          quiet: true,
        });
        ready = true;
        break;
      } catch {
        if (interrupted) throw new Error("Local PG run interrupted");
        await delay(250);
      }
    }
    if (!ready) throw new Error("Synthetic PostgreSQL did not become ready");
    const binding = await execute("docker", ["port", container, "5432/tcp"], { quiet: true });
    if (!/^127\.0\.0\.1:\d+$/.test(binding))
      throw new Error("PG port is not exclusively bound to 127.0.0.1");
    const env = syntheticEnvironment(Number(binding.split(":")[1]), password);
    for (const name of Object.values(names))
      await execute("docker", ["exec", container, "createdb", "-U", role, name], { quiet: true });
    await execute("pnpm", ["build:packages"], { env });

    const guard = (expected) => (database, user) => {
      if (database !== expected || user !== role) throw new Error("Synthetic PG identity mismatch");
    };
    const { tsImport } = await import("tsx/esm/api");
    const options = {
      parentURL: import.meta.url,
      tsconfig: join(root, "test/domain/tsconfig.json"),
    };
    const { runMigrations: appMigrate } = await tsImport(
      pathToFileURL(join(root, "apps/web/src/lib/db/migration-runner.ts")).href,
      options,
    );
    const { defaultMigrationSource } = await tsImport(
      pathToFileURL(join(root, "apps/web/src/lib/db/migration-source.ts")).href,
      options,
    );
    const { runMigrations } = await import("../packages/persistence-pg/dist/migrations/index.js");
    await appMigrate({ url: env.DATABASE_URL, guard: guard(names.app) });
    await appMigrate({
      url: env.N2_REFERENCE_DATABASE_URL,
      guard: guard(names.reference),
      source: {
        list: () => defaultMigrationSource.list().slice(0, 2),
        read: (name) => defaultMigrationSource.read(name),
      },
    });
    for (const [key, profile] of [
      ["AUTH_PG_TEST_URL", "auth"],
      ["AUTH_CREDITS_PG_TEST_URL", "auth_credits"],
      ["COMMERCE_PG_DATABASE_URL", "auth_credits"],
      ["COMMERCE_PG_FOREIGN_DATABASE_URL", "auth_credits"],
    ]) {
      const url = env[key];
      await runMigrations({ url, profile, guard: guard(new URL(url).pathname.slice(1)) });
    }

    for (const suite of ["domain", "packages"]) {
      const files = (await readdir(join(root, "test", suite)))
        .filter((name) => name.endsWith(suite === "domain" ? ".test.ts" : ".test.mjs"))
        .sort()
        .map((name) => join("test", suite, name));
      if (suite === "packages") await execute("pnpm", ["check:boundaries"], { env });
      // Existing package fixtures use short explicit secrets. Domain retains Origin validation.
      const testEnv = suite === "packages" ? { ...env, NODE_ENV: "test" } : env;
      const loader =
        suite === "domain" ? ["--experimental-test-module-mocks", "--import", "tsx"] : [];
      console.log(`[PG local] Running every ${suite} test`);
      const tap = await execute(
        process.execPath,
        [...loader, "--test", "--test-concurrency=1", "--test-reporter=tap", ...files],
        { env: testEnv },
      );
      assertZeroSkips(tap);
    }
    console.log("[PG local] All domain and package tests passed with zero skips");
  } finally {
    try {
      if (creationAttempted) {
        let label;
        try {
          label = await execute(
            "docker",
            ["inspect", "--format", '{{index .Config.Labels "nexty.pg-local.owner"}}', container],
            { quiet: true, cleanup: true },
          );
        } catch {
          // A failed docker run may never have created the named container.
          const ids = await execute("docker", ["ps", "-aq", "--filter", `name=^/${container}$`], {
            quiet: true,
            cleanup: true,
          });
          if (ids) throw new Error("Cannot verify temporary PG ownership for cleanup");
        }
        if (label !== undefined) {
          if (label !== owner)
            throw new Error("Refusing to stop a PG container owned by another run");
          await execute("docker", ["stop", "--timeout", "5", container], {
            quiet: true,
            cleanup: true,
          });
          // Docker stop can finish before --rm completes; do not report removal early.
          let removed = false;
          for (let attempt = 0; attempt < 100; attempt += 1) {
            const ids = await execute("docker", ["ps", "-aq", "--filter", `name=^/${container}$`], {
              quiet: true,
              cleanup: true,
            });
            if (!ids) {
              removed = true;
              break;
            }
            await delay(100);
          }
          if (!removed) throw new Error("Temporary PG stopped but container removal did not finish");
          console.log(`[PG local] Removed ${container}`);
        }
      }
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
