import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createDatabase, createDatabaseConfig } from "../../packages/db/dist/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dbPkg = join(repoRoot, "packages", "db");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("manifest is an explicit ESM connection factory without env loading", async () => {
  const pkg = await readJson(join(dbPkg, "package.json"));
  assert.equal(pkg.name, "@sunpcm/niu-db");
  assert.equal(pkg.version, "0.1.0-next.0");
  assert.equal(pkg.type, "module");
  assert.deepEqual(pkg.exports["."], {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
  });
  assert.deepEqual(pkg.files, ["dist"]);
  assert.equal(pkg.dependencies["dotenv"], undefined);
  assert.equal(pkg.devDependencies["dotenv"], undefined);
  assert.equal(pkg.devDependencies["drizzle-kit"], undefined);
  assert.equal(pkg.devDependencies["tsx"], undefined);
  assert.equal(pkg.publishConfig.registry, "https://npm.pkg.github.com");
  assert.equal(pkg.publishConfig.access, "restricted");
});

test("empty connection string is rejected without opening a connection", () => {
  assert.throws(
    () => createDatabase({ connectionString: "" }),
    /connectionString is required/,
  );
  assert.throws(
    () => createDatabase({ connectionString: "   " }),
    /connectionString is required/,
  );
});

test("config mapping preserves every explicit driver option", () => {
  const options = createDatabaseConfig({
    maxConnections: 7,
    enablePrepare: false,
    enableSSL: "require",
    debug: true,
    idleTimeout: 33,
    connectTimeout: 12,
    maxLifetime: 90,
    applicationName: "nexty-test",
    onNotice: () => {},
  });

  assert.equal(options.max, 7);
  assert.equal(options.prepare, false);
  assert.equal(options.ssl, "require");
  assert.equal(options.debug, true);
  assert.equal(options.idle_timeout, 33);
  assert.equal(options.connect_timeout, 12);
  assert.equal(options.max_lifetime, 90);
  assert.equal(options.connection.application_name, "nexty-test");
  assert.equal(typeof options.onnotice, "function");
});

test("two config objects never share mutable state", () => {
  const first = createDatabaseConfig({ maxConnections: 3 });
  const second = createDatabaseConfig({});

  assert.equal(first.max, 3);
  assert.equal(second.max, undefined);
  assert.notEqual(first, second);

  first.max = 99;
  assert.equal(second.max, undefined);
  assert.equal(first.max, 99);
});

test("transform hooks are preserved verbatim (undefined -> null)", () => {
  const options = createDatabaseConfig({ transform: { undefined: null } });

  assert.deepEqual(options.transform, { undefined: null });
  assert.equal(options.transform.undefined, null);
});

test("connection parameters merge with applicationName without clobbering", () => {
  const options = createDatabaseConfig({
    applicationName: "nexty-app",
    connection: { statement_timeout: 30000 },
  });

  assert.equal(options.connection.statement_timeout, 30000);
  assert.equal(options.connection.application_name, "nexty-app");
});

test("explicit connection.application_name wins over the legacy top-level field", () => {
  const options = createDatabaseConfig({
    applicationName: "legacy-name",
    connection: { application_name: "explicit-name", statement_timeout: 15000 },
  });

  assert.equal(options.connection.application_name, "explicit-name");
  assert.equal(options.connection.statement_timeout, 15000);
});

test("transform and connection options are copied per instance, not shared", () => {
  const first = createDatabaseConfig({
    transform: { undefined: null },
    connection: { statement_timeout: 30000 },
  });
  const second = createDatabaseConfig({});

  assert.notEqual(first.transform, second.transform);
  assert.notEqual(first.connection, second.connection);
  assert.equal(second.transform, undefined);
  assert.equal(second.connection, undefined);

  first.connection.statement_timeout = 999;
  assert.equal(second.connection, undefined);
});

test("empty connection string never opens an implicit driver connection", () => {
  // The factory rejects before constructing a `postgres("")` client, so it can
  // never fall back to the driver's PG* environment defaults.
  assert.throws(
    () => createDatabase({ connectionString: "" }),
    /connectionString is required/,
  );
  assert.throws(
    () => createDatabase({ connectionString: "   " }),
    /connectionString is required/,
  );
});

test("factory close is the single owner and is idempotent", async () => {
  // A non-connectable URL keeps the client lazy (no socket, no PG) while still
  // exercising the real `postgres` client `end()` lifecycle.
  const handle = createDatabase({
    connectionString: "postgres://nexty@127.0.0.1:1/nexty",
    maxConnections: 1,
  });

  assert.equal(typeof handle.db, "object");
  assert.equal(typeof handle.client, "function");
  assert.equal(typeof handle.close, "function");

  await handle.close();
  await handle.close();
});
