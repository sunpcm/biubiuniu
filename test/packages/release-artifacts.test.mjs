import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createTgz } from "../../scripts/release/lib/tar.mjs";
import { validateAllowlist } from "../../scripts/release/lib/allowlist.mjs";
import { inspectTgz, analyzeClosure } from "../../scripts/release/lib/inspect.mjs";
import { buildManifest, manifestHashOf } from "../../scripts/release/lib/manifest.mjs";
import { prepareStableTgz } from "../../scripts/release/lib/stable.mjs";
import {
  validateLoopbackRegistry,
  assertLoopbackUrl,
  buildIsolatedNpmrc,
  minimalEnv,
  detectPublishConfig,
  verifyOneLocal,
  assertExpectedDistTag,
  isolatedNpmContext,
  publishOne,
  checkNpmVersion,
} from "../../scripts/release/lib/local-registry.mjs";
import { validateGate, missingPackages } from "../../scripts/release/lib/promote.mjs";
import { publishLocal, promoteRelease, preflightRelease, verifyManifestDocument } from "../../scripts/release/lib/release.mjs";
import { sha256Hex, sriFromHex, run, deepEqual } from "../../scripts/release/lib/util.mjs";

const require = createRequire(import.meta.url);
const COMMIT = "a".repeat(40);
const CLI_PATH = fileURLToPath(new URL("../../scripts/release/cli.mjs", import.meta.url));

function setEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function runCli(args) {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.error, undefined);
  return result;
}

function writeAllowlistFile(dir, packages = NAMES) {
  const path = join(dir, "allowlist.json");
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: 1,
      scope: "@sunpcm",
      packages: packages.map((name, i) => ({ name, path: `packages/p${i}` })),
    }),
  );
  return path;
}

const NAMES = [
  "@sunpcm/niu-utils",
  "@sunpcm/niu-contracts",
  "@sunpcm/niu-auth",
  "@sunpcm/niu-commerce",
  "@sunpcm/niu-ui",
  "@sunpcm/niu-db",
  "@sunpcm/niu-next",
  "@sunpcm/niu-feature-nano",
  "@sunpcm/niu-persistence-pg",
  "@sunpcm/niu-prettier-config",
];

const ALLOWLIST = validateAllowlist({
  schemaVersion: 1,
  scope: "@sunpcm",
  packages: NAMES.map((name, i) => ({ name, path: `packages/p${i}` })),
});

function pkgJson(name, version, deps = {}) {
  return {
    name,
    version,
    type: "module",
    exports: deps.exports ?? { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    files: ["dist"],
    dependencies: deps.dependencies ?? {},
    peerDependencies: deps.peerDependencies ?? {},
    optionalDependencies: deps.optionalDependencies ?? {},
    peerDependenciesMeta: deps.peerDependenciesMeta ?? {},
  };
}

function writeTgz(dir, files, { prefix = "package", extras = [] } = {}) {
  const entries = [];
  for (const [rel, content] of Object.entries(files)) {
    entries.push({ path: prefix ? `${prefix}/${rel}` : rel, type: "0", content: Buffer.from(content), mode: 0o644 });
  }
  for (const extra of extras) entries.push(extra);
  const out = join(dir, `pkg-${Math.random().toString(36).slice(2)}.tgz`);
  createTgz(entries, out);
  return out;
}

function validPackage(dir, name, version, deps = {}, code = "export const x = 1;\n") {
  return writeTgz(dir, {
    "package.json": `${JSON.stringify(pkgJson(name, version, deps), null, 2)}\n`,
    "dist/index.js": code,
    "dist/index.d.ts": "export declare const x: number;\n",
  });
}

function inspect(dir, name, version, deps = {}, code) {
  const tgz = validPackage(dir, name, version, deps, code);
  return { tgz, ...inspectTgz(tgz, { allowlist: ALLOWLIST }) };
}

function makeRecord(dir, name, version, deps = {}) {
  const tgz = validPackage(dir, name, version, deps);
  const bytes = readFileSync(tgz);
  const sha256 = sha256Hex(bytes);
  return {
    name,
    version,
    tgz,
    bytes,
    sha256,
    sri: sriFromHex(sha256),
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  };
}

function makeManifest(dir, records, channel = "candidate") {
  const artifacts = [...records.values()].map((r) => {
    const a = inspectTgz(r.tgz, { allowlist: ALLOWLIST }).artifact;
    return { name: a.name, version: a.version, tgzPath: r.tgz, artifact: a };
  });
  return buildManifest({ scope: "@sunpcm", sourceCommit: COMMIT, channel, artifacts });
}

function registryFetch(records, base = "http://127.0.0.1:4873", getDistTags) {
  return async (url, opts) => {
    assert.equal(opts.redirect, "error");
    const u = String(url);
    const rec = [...records.values()].find((r) => u.includes(`/${r.name.replace("/", "%2F")}`));
    if (!rec) return { ok: true, status: 404 };
    if (u.includes("/-/")) {
      return { ok: true, status: 200, arrayBuffer: async () => rec.bytes.buffer.slice(rec.bytes.byteOffset, rec.bytes.byteOffset + rec.bytes.byteLength) };
    }
    const distTags = getDistTags ? getDistTags(rec) : { candidate: rec.version };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        "dist-tags": distTags,
        versions: { [rec.version]: { name: rec.name, version: rec.version, dist: { tarball: `${base}/${rec.name.replace("/", "%2F")}/-/${rec.name.split("/")[1]}-${rec.version}.tgz`, integrity: rec.integrity } } },
      }),
    };
  };
}

const REQUIRED_GATE_IDS = [
  ["minimal", "profile"],
  ["auth_credits", "profile"],
  ["nano_payments", "profile"],
  ["node", "runtime"],
  ["vite", "runtime"],
  ["next", "runtime"],
];

function makeEvidenceDoc(check, entry) {
  return {
    schemaVersion: 1,
    id: check.id,
    result: "passed",
    exitCode: 0,
    manifestHash: check.manifestHash,
    packages: {
      [entry.name]: { version: entry.version, payloadHash: entry.payloadHash, sha256: entry.sha256 },
    },
    commands: ["node", "verify-install"],
  };
}

function makeGateCheck(dir, manifest, entry, id, kind) {
  const doc = makeEvidenceDoc({ id, manifestHash: manifest.manifestHash }, entry);
  const path = join(dir, `evidence-${id}.json`);
  writeFileSync(path, JSON.stringify(doc));
  const sha256 = sha256Hex(readFileSync(path));
  return {
    id,
    kind,
    result: "passed",
    exitCode: 0,
    manifestHash: manifest.manifestHash,
    packages: [entry.name],
    evidence: { path, sha256 },
  };
}

function buildGate(dir, manifest, entry) {
  const checks = REQUIRED_GATE_IDS.map(([id, kind]) => makeGateCheck(dir, manifest, entry, id, kind));
  return {
    schemaVersion: 1,
    manifestHash: manifest.manifestHash,
    payloadHashes: { [entry.name]: entry.payloadHash },
    checks,
  };
}

test("allowlist: rejects sibling scope names and duplicate normalized paths", () => {
  assert.throws(() => validateAllowlist({ schemaVersion: 1, scope: "@sunpcm", packages: [{ name: "@sunpcm-evil", path: "packages/evil" }] }));
  assert.throws(
    () =>
      validateAllowlist({
        schemaVersion: 1,
        scope: "@sunpcm",
        packages: [
          { name: "@sunpcm/a", path: "packages/a" },
          { name: "@sunpcm/b", path: "./packages/a" },
        ],
      }),
    /duplicate normalized path/,
  );
  assert.throws(
    () => validateAllowlist({ schemaVersion: 1, scope: "@sunpcm", packages: [{ name: "@sunpcm/a", path: "/abs" }] }),
    /non-relative/,
  );
});

test("inspect: legal wildcard exports and legal internal peer range are accepted", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-ui-"));
  const tgz = writeTgz(dir, {
    "package.json": `${JSON.stringify(
      pkgJson("@sunpcm/niu-ui", "0.1.0-next.0", {
        exports: {
          ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
          "./components/*": { types: "./dist/*.d.ts", import: "./dist/*.js" },
        },
      }),
      null,
      2,
    )}\n`,
    "dist/index.js": "export {};\n",
    "dist/index.d.ts": "export {};\n",
    "dist/button.js": "export const button = 1;\n",
    "dist/button.d.ts": "export declare const button: number;\n",
  });
  assert.equal(inspectTgz(tgz, { allowlist: ALLOWLIST }).ok, true);

  const next = inspect(dir, "@sunpcm/niu-next", "0.1.0-next.0", {
    peerDependencies: { "@sunpcm/niu-auth": "^0.1.0-next.0" },
  });
  assert.equal(next.ok, true);
});

test("inspect: strong internal dep must be exact; missing wildcard target still rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-bad-"));
  const strong = inspect(dir, "@sunpcm/niu-feature-nano", "0.1.0-next.0", {
    dependencies: { "@sunpcm/niu-commerce": "^0.1.0" },
  });
  assert.ok(strong.violations.some((v) => v.kind === "internal-dep-not-exact"));

  const wild = writeTgz(dir, {
    "package.json": `${JSON.stringify(
      pkgJson("@sunpcm/niu-ui", "0.1.0-next.0", { exports: { "./components/*": { types: "./dist/*.d.ts", import: "./dist/*.js" } } }),
      null,
      2,
    )}\n`,
    "dist/index.js": "export {};\n",
  });
  assert.ok(inspectTgz(wild, { allowlist: ALLOWLIST }).violations.some((v) => v.kind === "missing-export-target"));
});

test("cli: inspect exit status follows the result for text and JSON output", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-cli-inspect-"));
  const allowlist = writeAllowlistFile(dir);
  const accepted = validPackage(dir, "@sunpcm/niu-utils", "0.1.0-next.0");
  const rejected = validPackage(dir, "@sunpcm/not-allowed", "0.1.0-next.0");

  const rejectedText = runCli(["inspect", rejected, "--allowlist", allowlist]);
  assert.equal(rejectedText.status, 1);
  assert.match(rejectedText.stderr, /^FAIL /);

  const rejectedJson = runCli(["inspect", rejected, "--allowlist", allowlist, "--json"]);
  assert.equal(rejectedJson.status, 1);
  assert.equal(rejectedJson.stderr, "");
  assert.equal(JSON.parse(rejectedJson.stdout).ok, false);

  const acceptedText = runCli(["inspect", accepted, "--allowlist", allowlist]);
  assert.equal(acceptedText.status, 0);
  assert.match(acceptedText.stdout, /^OK /);

  const acceptedJson = runCli(["inspect", accepted, "--allowlist", allowlist, "--json"]);
  assert.equal(acceptedJson.status, 0);
  assert.equal(JSON.parse(acceptedJson.stdout).ok, true);
});

test("closure: strong version mismatch and unsatisfied peer are reported", () => {
  const artifacts = [
    { name: "@sunpcm/niu-a", version: "1.0.0", internalDeps: [{ field: "dependencies", name: "@sunpcm/niu-b", spec: "2.0.0" }] },
    { name: "@sunpcm/niu-b", version: "1.0.0", internalDeps: [] },
  ];
  const r1 = analyzeClosure(artifacts);
  assert.ok(r1.violations.some((v) => v.kind === "internal-version-mismatch"));

  const peerOk = analyzeClosure([
    { name: "@sunpcm/niu-next", version: "0.1.0-next.0", internalDeps: [{ field: "peerDependencies", name: "@sunpcm/niu-auth", spec: "^0.1.0-next.0" }] },
    { name: "@sunpcm/niu-auth", version: "0.1.0-next.0", internalDeps: [] },
  ]);
  assert.equal(peerOk.ok, true);

  const peerBad = analyzeClosure([
    { name: "@sunpcm/niu-next", version: "0.1.0-next.0", internalDeps: [{ field: "peerDependencies", name: "@sunpcm/niu-auth", spec: "^1.0.0" }] },
    { name: "@sunpcm/niu-auth", version: "0.1.0-next.0", internalDeps: [] },
  ]);
  assert.ok(peerBad.violations.some((v) => v.kind === "internal-peer-unsatisfied"));
});

test("prepare-stable: refuses to overwrite the preview or a pre-existing target", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-stable-"));
  const preview = validPackage(dir, "@sunpcm/niu-utils", "0.1.0-next.0");
  assert.throws(() => prepareStableTgz({ previewTgzPath: preview, outTgzPath: preview, version: "1.0.0" }), /new path|resolves|already exists|\.\.|\. segments|not contain/);
  assert.throws(() => prepareStableTgz({ previewTgzPath: preview, outTgzPath: `./${preview.split("/").pop()}`, version: "1.0.0" }), /not contain/);

  const out = join(dir, "stable.tgz");
  const report = prepareStableTgz({ previewTgzPath: preview, outTgzPath: out, version: "1.0.0", internalVersions: {} });
  assert.equal(report.ok, true);
  assert.throws(() => prepareStableTgz({ previewTgzPath: preview, outTgzPath: out, version: "1.0.1" }), /already exists/);
});

test("prepare-stable: atomic exclusive commit preserves a competing target", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-stable-race-"));
  const preview = validPackage(dir, "@sunpcm/niu-utils", "0.1.0-next.0");
  const out = join(dir, "stable.tgz");
  writeFileSync(out, "competing-producer-bytes");
  assert.throws(() => prepareStableTgz({ previewTgzPath: preview, outTgzPath: out, version: "1.0.0" }), /already exists/);
  assert.equal(readFileSync(out, "utf8"), "competing-producer-bytes");

  const fresh = join(dir, "stable-2.tgz");
  const report = prepareStableTgz({ previewTgzPath: preview, outTgzPath: fresh, version: "1.0.0" });
  assert.equal(report.ok, true);
  assert.ok(existsSync(fresh));
});

test("registry: loopback rejects localhost and https", () => {
  assert.equal(validateLoopbackRegistry("http://127.0.0.1:4873"), "http://127.0.0.1:4873");
  assert.equal(validateLoopbackRegistry("http://[::1]:4873"), "http://[::1]:4873");
  assert.throws(() => validateLoopbackRegistry("http://localhost:4873"));
  assert.throws(() => validateLoopbackRegistry("https://127.0.0.1:4873"));
  assert.throws(() => assertLoopbackUrl("http://127.0.0.1:9999/x", "url", "http://127.0.0.1:4873"));
});

test("assertExpectedDistTag: baseline-aware candidate/latest states", () => {
  const base = { name: "@sunpcm/niu-utils", version: "0.1.1", tag: "candidate" };
  // old latest preserved is fine
  assert.doesNotThrow(() => assertExpectedDistTag({ ...base, distTags: { candidate: "0.1.1", latest: "0.1.0" }, baseline: { latest: "0.1.0" } }));
  // latest advanced to the un-gated candidate -> fail closed
  assert.throws(() => assertExpectedDistTag({ ...base, distTags: { candidate: "0.1.1", latest: "0.1.1" }, baseline: { latest: "0.1.0" } }), /latest/);
  // latest appears where it was previously absent -> fail closed
  assert.throws(() => assertExpectedDistTag({ ...base, distTags: { candidate: "0.1.1", latest: "0.1.1" }, baseline: {} }), /latest/);
  // absent latest preserved -> ok
  assert.doesNotThrow(() => assertExpectedDistTag({ ...base, distTags: { candidate: "0.1.1" }, baseline: {} }));
  // no baseline at all -> fail closed
  assert.throws(() => assertExpectedDistTag({ ...base, distTags: { candidate: "0.1.1" } }), /baseline/);
  // selected tag missing -> fail
  assert.throws(() => assertExpectedDistTag({ ...base, distTags: { latest: "0.1.1" }, baseline: { latest: "0.1.0" } }), /candidate/);
  // selected tag points elsewhere -> fail
  assert.throws(() => assertExpectedDistTag({ ...base, distTags: { candidate: "0.0.9", latest: "0.1.0" }, baseline: { latest: "0.1.0" } }), /candidate/);
});

test("publishLocal: topological order, remote reuse, read-back and tag before receipt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "release-pub-"));
  const records = new Map();
  records.set("@sunpcm/niu-utils", makeRecord(dir, "@sunpcm/niu-utils", "0.1.0-next.0"));
  const manifest = makeManifest(dir, records);

  const order = [];
  const published = new Set();
  const runner = (cmd, args) => {
    if (args[0] === "publish") {
      order.push(args[1].split("/").pop());
      const rec = [...records.values()].find((r) => r.tgz === args[1]);
      if (rec) published.add(rec.name);
    }
    return { ok: true, stdout: "", stderr: "" };
  };
  const fetchFn = async (url, opts) => {
    assert.equal(opts.redirect, "error");
    const u = String(url);
    const rec = [...records.values()].find((r) => u.includes(`/${r.name.replace("/", "%2F")}`));
    if (!rec || !published.has(rec.name)) return { ok: true, status: 404 };
    if (u.includes("/-/")) return { ok: true, status: 200, arrayBuffer: async () => rec.bytes.buffer.slice(rec.bytes.byteOffset, rec.bytes.byteOffset + rec.bytes.byteLength) };
    return { ok: true, status: 200, json: async () => ({ "dist-tags": { candidate: rec.version }, versions: { [rec.version]: { name: rec.name, version: rec.version, dist: { tarball: `http://127.0.0.1:4873/${rec.name.replace("/", "%2F")}/-/${rec.name.split("/")[1]}-${rec.version}.tgz`, integrity: rec.integrity } } } }) };
  };
  const receiptsPath = join(dir, "receipts.json");
  const receipts = await publishLocal({
    manifest,
    allowlist: ALLOWLIST,
    registry: "http://127.0.0.1:4873",
    tag: "candidate",
    receiptsPath,
    resolveTarball: (p) => (p.startsWith("/") ? p : join(dir, p)),
    runner,
    fetchFn,
  });
  assert.equal(order.length, 1);
  assert.equal(receipts.packages["@sunpcm/niu-utils"].integrity, manifest.packages["@sunpcm/niu-utils"].sri);
  assert.equal(receipts.packages["@sunpcm/niu-utils"].status, "verified");
  assert.ok(existsSync(receiptsPath));

  const reused = await publishLocal({
    manifest,
    allowlist: ALLOWLIST,
    registry: "http://127.0.0.1:4873",
    tag: "candidate",
    resolveTarball: (p) => (p.startsWith("/") ? p : join(dir, p)),
    runner,
    fetchFn,
  });
  assert.equal(order.length, 1);
  assert.equal(reused.packages["@sunpcm/niu-utils"].integrity, manifest.packages["@sunpcm/niu-utils"].sri);
});

test("publishLocal: rejects latest/stable tag before any subprocess", async () => {
  const dir = mkdtempSync(join(tmpdir(), "release-tag-"));
  const records = new Map([["@sunpcm/niu-utils", makeRecord(dir, "@sunpcm/niu-utils", "0.1.0-next.0")]]);
  const manifest = makeManifest(dir, records);
  await assert.rejects(
    () =>
      publishLocal({
        manifest,
        allowlist: ALLOWLIST,
        registry: "http://127.0.0.1:4873",
        tag: "latest",
        resolveTarball: (p) => (p.startsWith("/") ? p : join(dir, p)),
        runner: () => ({ ok: true, stdout: "", stderr: "" }),
        fetchFn: registryFetch(records),
      }),
    /candidate/,
  );
});

test("validateGate: accepts a complete bound gate and rejects empty/wrong/missing/uncovered", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-gate-"));
  const records = new Map([["@sunpcm/niu-utils", makeRecord(dir, "@sunpcm/niu-utils", "1.0.0")]]);
  const manifest = makeManifest(dir, records, "candidate");
  const entry = manifest.packages["@sunpcm/niu-utils"];
  const readEvidence = (p) => readFileSync(p);

  const gate = buildGate(dir, manifest, entry);
  assert.equal(validateGate({ manifest, gate, readEvidence }).ok, true);

  const empty = structuredClone(gate);
  empty.checks[0].evidence = null;
  assert.equal(validateGate({ manifest, gate: empty, readEvidence }).ok, false);

  const wrongHash = structuredClone(gate);
  wrongHash.checks[0].evidence = { ...gate.checks[0].evidence, sha256: "0".repeat(64) };
  assert.equal(validateGate({ manifest, gate: wrongHash, readEvidence }).ok, false);

  const missingProfile = structuredClone(gate);
  missingProfile.checks = gate.checks.filter((c) => c.id !== "nano_payments");
  assert.equal(validateGate({ manifest, gate: missingProfile, readEvidence }).ok, false);

  const uncovered = structuredClone(gate);
  uncovered.checks = gate.checks.map((c) => ({ ...c, packages: [] }));
  assert.equal(validateGate({ manifest, gate: uncovered, readEvidence }).ok, false);
});

test("promoteRelease: evidence read, full receipts, stable semver, stable dist-tag", async () => {
  const dir = mkdtempSync(join(tmpdir(), "release-promote-"));
  const records = new Map([["@sunpcm/niu-utils", makeRecord(dir, "@sunpcm/niu-utils", "1.0.0")]]);
  const manifest = makeManifest(dir, records, "candidate");
  const entry = manifest.packages["@sunpcm/niu-utils"];
  const receipts = {
    schemaVersion: 1,
    manifestHash: manifest.manifestHash,
    registry: "http://127.0.0.1:4873",
    tag: "candidate",
    packages: { "@sunpcm/niu-utils": { version: "1.0.0", integrity: entry.sri, status: "verified", baseline: {} } },
  };
  const gate = buildGate(dir, manifest, entry);
  const readEvidence = (p) => readFileSync(p);

  const stableTags = new Set();
  const tags = [];
  const runner = (cmd, args) => {
    if (args[0] === "dist-tag") {
      const at = args[2].lastIndexOf("@");
      const name = args[2].slice(0, at);
      const version = args[2].slice(at + 1);
      if (args[3] === "stable") stableTags.add(name);
      tags.push(`${name}@${version}->${args[3]}`);
    }
    return { ok: true, stdout: "", stderr: "" };
  };
  const fetchFn = registryFetch(records, "http://127.0.0.1:4873", (rec) => {
    const dt = { candidate: rec.version };
    if (stableTags.has(rec.name)) dt.stable = rec.version;
    return dt;
  });
  const stablePath = join(dir, "stable.json");
  const result = await promoteRelease({
    manifest,
    registry: "http://127.0.0.1:4873",
    receipts,
    gate,
    stableManifestPath: stablePath,
    runner,
    fetchFn,
    readEvidence,
  });
  assert.equal(result.ok, true);
  assert.equal(tags.length, 1);
  assert.equal(JSON.parse(readFileSync(stablePath, "utf8")).channel, "stable");

  const pre = makeManifest(dir, new Map([["@sunpcm/niu-utils", makeRecord(dir, "@sunpcm/niu-utils", "0.1.0-next.0")]]), "candidate");
  await assert.rejects(
    () =>
      promoteRelease({
        manifest: pre,
        registry: "http://127.0.0.1:4873",
        receipts: { ...receipts, manifestHash: pre.manifestHash },
        gate,
        stableManifestPath: stablePath,
        runner,
        fetchFn: registryFetch(records),
        readEvidence,
      }),
    /prerelease/,
  );

  // incomplete receipts are rejected before promotion
  const incompleteReceipts = { ...receipts, packages: {} };
  await assert.rejects(
    () =>
      promoteRelease({
        manifest,
        registry: "http://127.0.0.1:4873",
        receipts: incompleteReceipts,
        gate,
        stableManifestPath: stablePath,
        runner,
        fetchFn,
        readEvidence,
      }),
    /incomplete/,
  );
});

test("manifest: sourceCommit must be a 40-hex caller-bound string", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-src-"));
  const records = new Map([["@sunpcm/niu-utils", makeRecord(dir, "@sunpcm/niu-utils", "0.1.0-next.0")]]);
  const artifacts = [...records.values()].map((r) => {
    const a = inspectTgz(r.tgz, { allowlist: ALLOWLIST }).artifact;
    return { name: a.name, version: a.version, tgzPath: r.tgz, artifact: a };
  });
  assert.throws(() => buildManifest({ scope: "@sunpcm", sourceCommit: "abc123", channel: "preview", artifacts }), /40-hex/);
  const good = buildManifest({ scope: "@sunpcm", sourceCommit: COMMIT, channel: "preview", artifacts });
  const bad = { ...good, sourceCommit: "abc123", manifestHash: "0".repeat(64) };
  assert.equal(verifyManifestDocument(bad).ok, false);
});

test("verify-local transport: metadata sha512 integrity is enforced and same-origin is required", async () => {
  const dir = mkdtempSync(join(tmpdir(), "release-verify-"));
  const rec = makeRecord(dir, "@sunpcm/niu-utils", "0.1.0-next.0");
  const fetchFn = async (url, opts) => {
    const u = String(url);
    if (u.includes("/-/")) return { ok: true, status: 200, arrayBuffer: async () => rec.bytes.buffer.slice(rec.bytes.byteOffset, rec.bytes.byteOffset + rec.bytes.byteLength) };
    return { ok: true, status: 200, json: async () => ({ "dist-tags": { candidate: rec.version }, versions: { [rec.version]: { name: rec.name, version: rec.version, dist: { tarball: "http://127.0.0.1:4873/@sunpcm%2Fniu-utils/-/x.tgz", integrity: rec.integrity } } } }) };
  };
  const entry = { name: rec.name, version: rec.version, sha256: rec.sha256, sri: rec.sri };
  const verified = await verifyOneLocal({ entry, registry: "http://127.0.0.1:4873", baseline: {}, fetchFn });
  assert.equal(verified.integrity, rec.sri);

  const badFetch = async (url, opts) => {
    const u = String(url);
    if (u.includes("/-/")) return { ok: true, status: 200, arrayBuffer: async () => rec.bytes.buffer.slice(rec.bytes.byteOffset, rec.bytes.byteOffset + rec.bytes.byteLength) };
    return { ok: true, status: 200, json: async () => ({ "dist-tags": { candidate: rec.version }, versions: { [rec.version]: { name: rec.name, version: rec.version, dist: { tarball: "http://127.0.0.1:4873/@sunpcm%2Fniu-utils/-/x.tgz", integrity: "sha512-AAAA" } } } }) };
  };
  await assert.rejects(() => verifyOneLocal({ entry, registry: "http://127.0.0.1:4873", baseline: {}, fetchFn: badFetch }), /integrity/);
});

test("verifyOneLocal: fails closed when latest advances past the recorded baseline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "release-latest-"));
  const rec = makeRecord(dir, "@sunpcm/niu-utils", "0.1.1");
  const entry = { name: rec.name, version: rec.version, sha256: rec.sha256, sri: rec.sri };
  const fetchFn = async (url, opts) => {
    const u = String(url);
    if (u.includes("/-/")) return { ok: true, status: 200, arrayBuffer: async () => rec.bytes.buffer.slice(rec.bytes.byteOffset, rec.bytes.byteOffset + rec.bytes.byteLength) };
    return { ok: true, status: 200, json: async () => ({ "dist-tags": { candidate: rec.version, latest: rec.version }, versions: { [rec.version]: { name: rec.name, version: rec.version, dist: { tarball: "http://127.0.0.1:4873/@sunpcm%2Fniu-utils/-/x.tgz", integrity: rec.integrity } } } }) };
  };
  await assert.rejects(
    () => verifyOneLocal({ entry, registry: "http://127.0.0.1:4873", baseline: { latest: "0.1.0" }, fetchFn }),
    /latest/,
  );
});

test("registry: isolated npmrc and minimal env never inherit proxy/credentials", () => {
  const npmrc = buildIsolatedNpmrc({ registry: "http://127.0.0.1:4873", authToken: "tok", scope: "@sunpcm" });
  assert.match(npmrc, /registry=http:\/\/127\.0\.0\.1:4873\//);
  assert.match(npmrc, /@sunpcm:registry=http:\/\/127\.0\.0\.1:4873\//);
  assert.match(npmrc, /\/\/127\.0\.0\.1:4873\/:_authToken=tok/);
  assert.match(npmrc, /proxy=/);

  const env = minimalEnv({ allowedOrigin: "http://127.0.0.1:4873" });
  assert.equal("HTTP_PROXY" in env, false);
  assert.equal("HTTPS_PROXY" in env, false);
  assert.equal("NPM_CONFIG_REGISTRY" in env, false);
  assert.match(env.NODE_OPTIONS, /--require=.*request-guard\.cjs/);
  assert.equal(env.NEXTY_RELEASE_ALLOWED_ORIGIN, "http://127.0.0.1:4873");
});

test("registry: distinct isolated configs and real npm config get registry ignores parent public registry", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-npmcfg-"));
  const ctx = isolatedNpmContext({ registry: "http://127.0.0.1:4873", scope: "@sunpcm", authToken: "tok", tmpDir: dir });
  assert.notEqual(ctx.userconfig, ctx.globalconfig);
  const user = readFileSync(ctx.userconfig, "utf8");
  const globalCfg = readFileSync(ctx.globalconfig, "utf8");
  assert.match(user, /registry=http:\/\/127\.0\.0\.1:4873\//);
  assert.match(user, /:_authToken=tok/);
  assert.equal(globalCfg.trim(), "");

  // Simulate the task runner's known public-registry environment. The parent's
  // NPM_CONFIG_REGISTRY (and lower-case alias) plus proxy variables must not
  // leak into the production child, which is isolated via minimalEnv + explicit
  // --registry (mirroring publishOne's npmArgs construction).
  const saved = {
    NPM_CONFIG_REGISTRY: process.env.NPM_CONFIG_REGISTRY,
    npm_config_registry: process.env.npm_config_registry,
    HTTP_PROXY: process.env.HTTP_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
  };
  setEnv("NPM_CONFIG_REGISTRY", "https://registry.npmjs.org/");
  setEnv("npm_config_registry", "https://registry.npmjs.org/");
  setEnv("HTTP_PROXY", "http://127.0.0.1:1");
  setEnv("HTTPS_PROXY", "http://127.0.0.1:1");
  try {
    const env = minimalEnv({ allowedOrigin: "http://127.0.0.1:4873" });
    assert.equal("NPM_CONFIG_REGISTRY" in env, false);
    assert.equal("npm_config_registry" in env, false);
    assert.equal("HTTP_PROXY" in env, false);
    assert.equal("HTTPS_PROXY" in env, false);

    const res = run("npm", [
      "config",
      "get",
      "registry",
      "--registry",
      "http://127.0.0.1:4873/",
      "--userconfig",
      ctx.userconfig,
      "--globalconfig",
      ctx.globalconfig,
    ], { env });
    assert.equal(res.ok, true, res.stderr || res.error?.message);
    assert.equal(res.stdout.trim(), "http://127.0.0.1:4873/");
  } finally {
    setEnv("NPM_CONFIG_REGISTRY", saved.NPM_CONFIG_REGISTRY);
    setEnv("npm_config_registry", saved.npm_config_registry);
    setEnv("HTTP_PROXY", saved.HTTP_PROXY);
    setEnv("HTTPS_PROXY", saved.HTTPS_PROXY);
  }
});

test("registry: detects packed publishConfig target", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-pubcfg-"));
  const tgz = writeTgz(dir, {
    "package.json": `${JSON.stringify({ ...pkgJson("@sunpcm/niu-utils", "0.1.0-next.0"), publishConfig: { registry: "https://npm.pkg.github.com" } }, null, 2)}\n`,
    "dist/index.js": "export {};\n",
    "dist/index.d.ts": "export {};\n",
  });
  assert.equal(detectPublishConfig(tgz).registry, "https://npm.pkg.github.com");
});

test("request-guard: origin normalization and non-allowed rejection", () => {
  const guard = require("../../scripts/release/lib/request-guard.cjs");
  const allowed = "http://127.0.0.1:4873";
  assert.equal(guard.originOf("http://127.0.0.1:4873/x"), allowed);

  // URL string resolves to its origin
  assert.deepEqual(guard.resolveOrigin("http://127.0.0.1:4873/x", null, "http:"), { origin: allowed });

  // options.hostname overrides the URL string -> final effective target is evil
  const overridden = guard.resolveOrigin("http://127.0.0.1:4873/x", { hostname: "evil.example.com", port: 4873 }, "http:");
  assert.deepEqual(overridden, { origin: "http://evil.example.com:4873" });
  assert.equal(guard.isAllowedOrigin(overridden.origin, allowed), false);

  // missing host / unparseable -> fail closed
  assert.ok(guard.resolveOrigin("/x", {}, "http:").error);
  assert.ok(guard.resolveOrigin("not a url", {}, "http:").error);

  // IPv6 + port normalization
  assert.equal(guard.resolveOrigin("http://[::1]:4873/x", null, "http:").origin, "http://[::1]:4873");
  assert.equal(guard.resolveOrigin("http://127.0.0.1/x", null, "http:").origin, "http://127.0.0.1");

  // fetchOrigin
  assert.deepEqual(guard.fetchOrigin("http://127.0.0.1:4873/x"), { origin: allowed });
  assert.ok(guard.fetchOrigin("::bad::").error);

  assert.throws(() => guard.assertAllowedOrigin("https://evil.example.com/x", allowed), /not allowed/);
  assert.doesNotThrow(() => guard.assertAllowedOrigin("http://127.0.0.1:4873/x", allowed));
});

test("request-guard: single options object overload (minipass-fetch send(options))", () => {
  const guard = require("../../scripts/release/lib/request-guard.cjs");
  const allowed = "http://127.0.0.1:4873";

  // http.request(options, cb): the first object is itself the options.
  assert.deepEqual(
    guard.resolveOrigin({ hostname: "127.0.0.1", port: 4873, path: "/x", method: "GET" }, null, "http:"),
    { origin: allowed },
  );
  assert.deepEqual(
    guard.resolveOrigin({ host: "127.0.0.1", port: 4873, path: "/x", method: "GET" }, null, "http:"),
    { origin: allowed },
  );
  // hostname wins over host; host is used literally (never split for port).
  assert.deepEqual(
    guard.resolveOrigin({ hostname: "127.0.0.1", host: "evil.example.com:9999", port: 4873 }, null, "http:"),
    { origin: allowed },
  );
  // protocol + IPv6 + explicit port are resolved like Node.
  assert.equal(
    guard.resolveOrigin({ protocol: "http:", hostname: "::1", port: 4873 }, null, "http:").origin,
    "http://[::1]:4873",
  );
  // no host -> fail closed
  assert.ok(guard.resolveOrigin({ path: "/x", method: "GET" }, null, "http:").error);

  // The guard accepts a legitimate single options object and rejects a foreign
  // one, matching the real minipass-fetch send(options) -> http.request(options).
  function mockClientRequest(input, options, cb) {
    if (typeof input === "string" || input instanceof URL) return typeof cb === "function" ? cb() : undefined;
    return typeof options === "function" ? options() : undefined;
  }
  const req = guard.guardRequest(mockClientRequest, "http:", allowed);
  let called = 0;
  req({ hostname: "127.0.0.1", port: 4873, path: "/x", method: "GET" }, () => { called += 1; });
  assert.equal(called, 1);
  assert.throws(
    () => req({ hostname: "evil.example.com", port: 4873, path: "/x", method: "GET" }, () => {}),
    /not allowed/,
  );
});

test("request-guard: socket boundary constrains TCP to exact registry host+port", () => {
  const guard = require("../../scripts/release/lib/request-guard.cjs");

  assert.deepEqual(guard.parseAllowedTarget("http://127.0.0.1:57591"), { host: "127.0.0.1", port: 57591 });
  assert.deepEqual(guard.parseAllowedTarget("http://[::1]:57591"), { host: "::1", port: 57591 });

  // Node internal normalized [options, cb] array (from net.connect) is read verbatim.
  assert.deepEqual(
    guard.socketTarget([[{ hostname: "127.0.0.1", port: 57591 }, null]]),
    { host: "127.0.0.1", port: 57591 },
  );
  assert.deepEqual(guard.socketTarget([{ host: "127.0.0.1", port: 57591 }]), { host: "127.0.0.1", port: 57591 });
  assert.deepEqual(guard.socketTarget([57591, "127.0.0.1"]), { host: "127.0.0.1", port: 57591 });
  assert.deepEqual(guard.socketTarget(["/tmp/x.sock"]), { path: "/tmp/x.sock" });
  assert.ok(guard.socketTarget([{ hostname: "127.0.0.1" }]).error);

  const allowedTarget = { host: "127.0.0.1", port: 57591 };
  const mk = (sink) => guard.guardSocketConnect(function (...args) { sink.called = true; return "ok"; }, allowedTarget);

  const good = { called: false };
  assert.equal(mk(good)([{ hostname: "127.0.0.1", port: 57591 }, null]), "ok");
  assert.equal(good.called, true);

  // A proxy/agent that keeps the HTTP URL unchanged but moves the socket target
  // is rejected before any connect.
  assert.throws(() => mk({})([{ host: "127.0.0.1", port: 9 }, null]), /not allowed/);
  assert.throws(() => mk({})([{ host: "evil.example.com", port: 57591 }, null]), /not allowed/);
  assert.throws(() => mk({})([{ path: "/tmp/x.sock" }, null]), /unix\/ipc/);
  assert.throws(() => mk({})([{ hostname: "127.0.0.1" }, null]), /no resolvable port/);

  // Real net.connect path is guarded at the socket boundary (rejects before TCP).
  const net = require("node:net");
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = guard.guardSocketConnect(originalConnect, allowedTarget);
  try {
    assert.throws(() => net.connect({ host: "127.0.0.1", port: 9 }), /not allowed/);
  } finally {
    net.Socket.prototype.connect = originalConnect;
  }

  // Audit records only stage/allow, no credentials.
  const auditDir = mkdtempSync(join(tmpdir(), "release-sockaudit-"));
  const auditPath = join(auditDir, "audit.log");
  guard.appendSocketAudit(auditPath, "127.0.0.1", 57591, true);
  const lines = readFileSync(auditPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines[0], { stage: "tcp", host: "127.0.0.1", port: 57591, allow: true });
});

test("request-guard: fetch redirect forced to error and non-allowed origin rejected", () => {
  const guard = require("../../scripts/release/lib/request-guard.cjs");
  const allowed = "http://127.0.0.1:4873";
  let captured;
  const wrapped = guard.guardFetch((input, init) => {
    captured = init;
    return { input, init };
  }, allowed);
  const out = wrapped("http://127.0.0.1:4873/x", { redirect: "follow" });
  assert.equal(captured.redirect, "error");
  assert.equal(out.input, "http://127.0.0.1:4873/x");
  assert.throws(() => wrapped("http://evil.example.com/x", { redirect: "follow" }), /not allowed/);

  // http request override is applied and non-allowed host is rejected
  const req = guard.guardRequest((input, options, cb) => cb?.(), "http:", allowed);
  let called = 0;
  req("/x", { hostname: "127.0.0.1", port: 4873 }, () => { called += 1; });
  assert.equal(called, 1);
  assert.throws(() => req("http://127.0.0.1:4873/x", { hostname: "evil.example.com", port: 4873 }, () => {}), /not allowed/);
  assert.throws(() => req("/x", {}, () => {}), /host/);

  // audit appends origin + path (no credentials)
  const auditDir = mkdtempSync(join(tmpdir(), "release-audit-"));
  const auditPath = join(auditDir, "audit.log");
  guard.appendAudit(auditPath, "http://127.0.0.1:4873", "/-/x");
  const lines = readFileSync(auditPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines[0], { origin: "http://127.0.0.1:4873", path: "/-/x" });
});

test("preflight: rejects wrong self-hash and tampered tarball before any subprocess", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-preflight-"));
  const records = new Map([["@sunpcm/niu-utils", makeRecord(dir, "@sunpcm/niu-utils", "0.1.0-next.0")]]);
  const manifest = makeManifest(dir, records);
  const resolveTarball = (p) => (p.startsWith("/") ? p : join(dir, p));

  const badHash = { ...manifest, manifestHash: "deadbeef".repeat(8) };
  assert.equal(preflightRelease({ manifest: badHash, allowlist: ALLOWLIST, resolveTarball }).ok, false);
  assert.equal(verifyManifestDocument(badHash).ok, false);

  writeFileSync(records.get("@sunpcm/niu-utils").tgz, Buffer.from("tampered"));
  assert.equal(preflightRelease({ manifest, allowlist: ALLOWLIST, resolveTarball }).ok, false);
});

test("preflight: rejects sri/payloadHash/databaseContract/dependencies/scope tampering", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-preflight-full-"));
  const records = new Map([["@sunpcm/niu-utils", makeRecord(dir, "@sunpcm/niu-utils", "0.1.0-next.0")]]);
  const manifest = makeManifest(dir, records);
  const resolveTarball = (p) => (p.startsWith("/") ? p : join(dir, p));
  const entry = manifest.packages["@sunpcm/niu-utils"];

  const badSri = { ...manifest, packages: { "@sunpcm/niu-utils": { ...entry, sri: "sha256-AAAA" } } };
  badSri.manifestHash = manifestHashOf(badSri);
  assert.equal(preflightRelease({ manifest: badSri, allowlist: ALLOWLIST, resolveTarball }).ok, false);

  const badPayload = { ...manifest, packages: { "@sunpcm/niu-utils": { ...entry, payloadHash: "0".repeat(64) } } };
  badPayload.manifestHash = manifestHashOf(badPayload);
  assert.equal(preflightRelease({ manifest: badPayload, allowlist: ALLOWLIST, resolveTarball }).ok, false);

  const badDeps = { ...manifest, packages: { "@sunpcm/niu-utils": { ...entry, dependencies: { "@sunpcm/niu-auth": "9.9.9" } } } };
  badDeps.manifestHash = manifestHashOf(badDeps);
  assert.equal(preflightRelease({ manifest: badDeps, allowlist: ALLOWLIST, resolveTarball }).ok, false);

  const wrongScope = { ...manifest, scope: "@other" };
  wrongScope.manifestHash = manifestHashOf(wrongScope);
  const res = preflightRelease({ manifest: wrongScope, allowlist: ALLOWLIST, resolveTarball });
  assert.equal(res.ok, false);
  assert.ok(res.reasons.some((r) => /scope/.test(r)));

  const malformed = { schemaVersion: 1, kind: "release", scope: "@sunpcm", channel: "preview", sourceCommit: COMMIT, packages: { "@sunpcm/niu-utils": null } };
  malformed.manifestHash = manifestHashOf(malformed);
  const res2 = preflightRelease({ manifest: malformed, allowlist: ALLOWLIST, resolveTarball });
  assert.equal(res2.ok, false);
  assert.ok(res2.reasons.some((r) => /not an object/.test(r)));
});

test("deepEqual: canonical structural comparison ignores object key order, preserves array order", () => {
  assert.equal(deepEqual({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }), true);
  assert.equal(deepEqual({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(deepEqual([1, 2], [2, 1]), false);
  assert.equal(deepEqual(null, null), true);
  assert.equal(deepEqual({ x: undefined }, { x: undefined }), true);
  assert.equal(deepEqual({ profiles: ["minimal", "auth"] }, { profiles: ["auth", "minimal"] }), false);
});

test("preflight: reordered dependency keys do not produce a false mismatch", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-canon-"));
  const rec = makeRecord(dir, "@sunpcm/niu-utils", "0.1.0-next.0", {
    dependencies: { react: "^18.0.0", zod: "^3.0.0" },
  });
  const manifest = makeManifest(dir, new Map([["@sunpcm/niu-utils", rec]]));
  const entry = manifest.packages["@sunpcm/niu-utils"];
  const reordered = { ...manifest, packages: { "@sunpcm/niu-utils": { ...entry, dependencies: { zod: "^3.0.0", react: "^18.0.0" } } } };
  reordered.manifestHash = manifestHashOf(reordered);
  const resolveTarball = (p) => (p.startsWith("/") ? p : join(dir, p));
  assert.equal(preflightRelease({ manifest: reordered, allowlist: ALLOWLIST, resolveTarball }).ok, true);
});

test("publishLocal: resume uses persisted baseline instead of current tags", async () => {
  const dir = mkdtempSync(join(tmpdir(), "release-resume-"));
  const rec = makeRecord(dir, "@sunpcm/niu-utils", "0.1.0-next.0");
  const manifest = makeManifest(dir, new Map([["@sunpcm/niu-utils", rec]]));
  const entry = manifest.packages["@sunpcm/niu-utils"];
  const receiptsPath = join(dir, "receipts.json");
  writeFileSync(receiptsPath, JSON.stringify({
    schemaVersion: 1,
    manifestHash: manifest.manifestHash,
    registry: "http://127.0.0.1:4873",
    tag: "candidate",
    packages: { "@sunpcm/niu-utils": { version: entry.version, integrity: entry.sri, size: null, status: "pending", baseline: { latest: "0.0.0" } } },
  }));
  const fetchFn = async (url, opts) => {
    assert.equal(opts.redirect, "error");
    const u = String(url);
    if (u.includes("/-/")) return { ok: true, status: 200, arrayBuffer: async () => rec.bytes.buffer.slice(rec.bytes.byteOffset, rec.bytes.byteOffset + rec.bytes.byteLength) };
    return { ok: true, status: 200, json: async () => ({ "dist-tags": { candidate: rec.version, latest: rec.version }, versions: { [rec.version]: { name: rec.name, version: rec.version, dist: { tarball: "http://127.0.0.1:4873/@sunpcm%2Fniu-utils/-/x.tgz", integrity: rec.integrity } } } }) };
  };
  await assert.rejects(
    () =>
      publishLocal({
        manifest,
        allowlist: ALLOWLIST,
        registry: "http://127.0.0.1:4873",
        tag: "candidate",
        receiptsPath,
        resolveTarball: (p) => (p.startsWith("/") ? p : join(dir, p)),
        runner: () => ({ ok: true, stdout: "", stderr: "" }),
        fetchFn,
      }),
    /latest/,
  );
});

test("validateGate: rejects evidence without an execution record", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-gate-exec-"));
  const records = new Map([["@sunpcm/niu-utils", makeRecord(dir, "@sunpcm/niu-utils", "1.0.0")]]);
  const manifest = makeManifest(dir, records, "candidate");
  const entry = manifest.packages["@sunpcm/niu-utils"];
  const gate = buildGate(dir, manifest, entry);
  const readEvidence = (p) => readFileSync(p);

  const noCommands = structuredClone(gate);
  const firstPath = noCommands.checks[0].evidence.path;
  const doc = JSON.parse(readFileSync(firstPath, "utf8"));
  doc.commands = [];
  writeFileSync(firstPath, JSON.stringify(doc));
  noCommands.checks[0].evidence.sha256 = sha256Hex(readFileSync(firstPath));
  assert.equal(validateGate({ manifest, gate: noCommands, readEvidence }).ok, false);
});

test("promoteRelease: stable tag is limited to 'stable'", async () => {
  const dir = mkdtempSync(join(tmpdir(), "release-stabletag-"));
  const records = new Map([["@sunpcm/niu-utils", makeRecord(dir, "@sunpcm/niu-utils", "1.0.0")]]);
  const manifest = makeManifest(dir, records, "candidate");
  const entry = manifest.packages["@sunpcm/niu-utils"];
  const receipts = {
    schemaVersion: 1,
    manifestHash: manifest.manifestHash,
    registry: "http://127.0.0.1:4873",
    tag: "candidate",
    packages: { "@sunpcm/niu-utils": { version: "1.0.0", integrity: entry.sri, status: "verified", baseline: {} } },
  };
  const gate = buildGate(dir, manifest, entry);
  await assert.rejects(
    () =>
      promoteRelease({
        manifest,
        registry: "http://127.0.0.1:4873",
        receipts,
        gate,
        stableManifestPath: join(dir, "stable.json"),
        stableTag: "candidate",
        runner: () => ({ ok: true, stdout: "", stderr: "" }),
        fetchFn: registryFetch(records),
        readEvidence: (p) => readFileSync(p),
      }),
    /stable tag/,
  );
});
