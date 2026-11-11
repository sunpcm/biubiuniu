import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertLocalDockerEndpoint,
  assertZeroSkips,
  syntheticEnvironment,
} from "../../scripts/test-pg-local.mjs";

test("local PG environment replaces inherited database URLs and business credentials", () => {
  const env = syntheticEnvironment(54329, "synthetic-only", {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    DATABASE_URL: "postgres://real.invalid/forbidden",
    GOOGLE_GENERATIVE_AI_API_KEY: "must-not-inherit",
    STRIPE_SECRET_KEY: "must-not-inherit",
    NODE_ENV: "test",
    NODE_OPTIONS: "--require=untrusted",
    PGHOST: "real.invalid",
  });
  assert.equal(env.GOOGLE_GENERATIVE_AI_API_KEY, undefined);
  assert.equal(env.STRIPE_SECRET_KEY, undefined);
  assert.equal(env.PGHOST, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.NODE_ENV, undefined, "domain must keep its Origin checks");
  assert.equal(env.NEXT_PUBLIC_SITE_URL, env.NEXT_PUBLIC_BETTER_AUTH_URL);
  const urls = Object.entries(env).filter(([key]) => /(?:DATABASE_URL|TEST_URL)$/.test(key));
  assert.equal(urls.length, 9);
  for (const [, raw] of urls) {
    const url = new URL(raw);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "54329");
    assert.equal(url.username, "nexty_overnight_test");
  }
  assert.throws(() => syntheticEnvironment(0, "test"), /port/);
});

test("local PG refuses remote Docker daemons before resource creation", () => {
  assertLocalDockerEndpoint("unix:///var/run/docker.sock");
  assertLocalDockerEndpoint("npipe:////./pipe/docker_engine");
  for (const remote of ["ssh://server", "tcp://127.0.0.1:2375", "https://server"])
    assert.throws(() => assertLocalDockerEndpoint(remote), /local Docker/);
});

test("a real Node runner exiting zero with a skipped test is rejected", () => {
  const scratch = mkdtempSync(join(tmpdir(), "nexty-pg-skip-"));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  try {
    const fixture = join(scratch, "skip.test.mjs");
    writeFileSync(
      fixture,
      'import test from "node:test"; test("PG absent", {skip:true}, () => {});',
    );
    const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", fixture], {
      encoding: "utf8",
      env,
    });
    assert.equal(result.status, 0);
    assert.throws(() => assertZeroSkips(result.stdout), /skip/);
    writeFileSync(fixture, 'import test from "node:test"; test("PG present", () => {});');
    const passed = spawnSync(process.execPath, ["--test", "--test-reporter=tap", fixture], {
      encoding: "utf8",
      env,
    });
    assert.equal(passed.status, 0);
    assertZeroSkips(passed.stdout);
    assert.throws(() => assertZeroSkips("no test summary"), /summary/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
