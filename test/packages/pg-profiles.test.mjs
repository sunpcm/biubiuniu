import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ALL_MODULES,
  PROFILES,
  assertSafeIdentifier,
  migrationStatements,
  planModules,
  planProfile,
  quoteIdentifier,
  resolveModule,
  sha256Hex,
} from "../../packages/persistence-pg/dist/migrations/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pgPkg = join(repoRoot, "packages", "persistence-pg");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function module(name, dependencies = [], sql = "select 1;") {
  return { name, version: 1, contractVersion: 1, description: name, dependencies, sql };
}

test("manifest exposes schema slices without a full-schema root", async () => {
  const pkg = await readJson(join(pgPkg, "package.json"));
  assert.equal(pkg.name, "@sunpcm/niu-persistence-pg");
  assert.equal(pkg.type, "module");
  assert.deepEqual(pkg.exports["."], {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
  });
  assert.equal(pkg.exports["./schema/auth"].import, "./dist/schema/auth.js");
  assert.equal(pkg.exports["./schema/commerce"].import, "./dist/schema/commerce.js");
});

test("profiles declare minimal, auth, and auth_credits", () => {
  assert.deepEqual(PROFILES.minimal.modules, []);
  assert.deepEqual(PROFILES.auth.modules, ["auth"]);
  assert.deepEqual(PROFILES.auth_credits.modules, ["auth", "payments", "credits"]);
});

test("planProfile orders the auth_credits dependency closure", () => {
  const plan = planProfile("auth_credits");
  assert.equal(plan.profile, "auth_credits");
  assert.deepEqual(
    plan.modules.map((m) => m.name),
    ["auth", "payments", "credits"],
  );
  assert.deepEqual(planProfile("auth").modules.map((m) => m.name), ["auth"]);
  assert.deepEqual(planProfile("minimal").modules, []);
});

test("statement normalization and checksum semantics are stable", () => {
  assert.equal(
    migrationStatements("  select 1;  --> statement-breakpoint\n\n select 2; \n"),
    "select 1;;\nselect 2;",
  );
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

  const resolved = resolveModule(module("x", [], "  create table x (id int);  --> statement-breakpoint\ncreate table y (id int);\n"));
  assert.equal(resolved.statements, "create table x (id int);;\ncreate table y (id int);");
  assert.equal(resolved.checksum, sha256Hex(resolved.statements));
  assert.equal(resolved.rawChecksum, sha256Hex(resolved.sql));
});

test("plans are isolated and do not share mutable arrays", () => {
  const first = planProfile("auth");
  const second = planProfile("auth");
  assert.notEqual(first.modules, second.modules);
  first.modules.push(null);
  assert.equal(second.modules.length, 1);
});

test("unknown module rejects clearly", () => {
  assert.throws(
    () => planModules([module("a")], ["missing"]),
    /Unknown migration module: missing/,
  );
});

test("duplicate module in manifest rejects clearly", () => {
  assert.throws(
    () => planModules([module("a"), module("a")], ["a"]),
    /duplicate module: a/,
  );
});

test("missing dependency inside the closure rejects clearly", () => {
  assert.throws(
    () => planModules([module("a", ["b"])], ["a"]),
    /Module a requires b/,
  );
});

test("dependency cycle rejects clearly", () => {
  assert.throws(
    () => planModules([module("a", ["b"]), module("b", ["a"])], ["a"]),
    /cycle/,
  );
});

test("static module manifest declares the four product modules", () => {
  assert.deepEqual(
    ALL_MODULES.map((m) => m.name).sort(),
    ["auth", "credits", "nano", "payments"],
  );
  for (const m of ALL_MODULES) {
    assert.equal(typeof m.sql, "string");
    assert.ok(m.sql.length > 0, `${m.name} must carry SQL`);
  }
});

test("modules declare a database contract version distinct from module version", () => {
  for (const m of ALL_MODULES) {
    assert.equal(typeof m.contractVersion, "number", `${m.name} must declare contractVersion`);
    assert.ok(m.contractVersion >= 1, `${m.name} must declare a positive contractVersion`);
  }
});

test("identifier validation rejects unsafe names before SQL is assembled", () => {
  assert.doesNotThrow(() => assertSafeIdentifier("_niu_migration_journal", "journal"));
  assert.doesNotThrow(() => assertSafeIdentifier("auth_credits", "profile"));
  assert.equal(quoteIdentifier("_niu_migration_journal"), `"_niu_migration_journal"`);

  for (const bad of ["bad-name", "bad name", "bad\"name", "1bad", "", "bad;drop"] ) {
    assert.throws(() => assertSafeIdentifier(bad, "journal"), /not a safe identifier/);
  }
});
