#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadAllowlist } from "./lib/allowlist.mjs";
import { inspectTgz, analyzeClosure } from "./lib/inspect.mjs";
import { buildManifest, serializeManifest } from "./lib/manifest.mjs";
import { prepareStableTgz } from "./lib/stable.mjs";
import { validateLoopbackRegistry, verifyLocal, checkNpmVersion } from "./lib/local-registry.mjs";
import { publishLocal, promoteRelease, preflightRelease } from "./lib/release.mjs";
import { ReleaseError } from "./lib/errors.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

const HELP = `nexty local release tool

Usage:
  node scripts/release/cli.mjs <command> [options]

Commands:
  inspect <tgz>                 Verify one reviewed tarball against the allowlist.
  manifest                      Build a deterministic release manifest from tarballs.
  prepare-stable <preview.tgz>  Promote a preview tarball to a stable tarball.
  publish-local <manifest.json> Publish to a loopback registry (candidate tag).
  verify-local <manifest.json>  Read back metadata/tarballs and confirm integrity.
  promote-local <manifest.json> Verify gate + stable tags, atomically record stable manifest.

Options:
  --allowlist <path>           Allowlist document (default: release/packages.json).
  --registry <url>             HTTP loopback registry (127.0.0.1 / ::1 only).
  --auth-token <token>         Synthetic bearer token for the loopback registry.
  --auth <base64>              Synthetic basic auth (user:pass base64).
  --tag <tag>                  candidate (publish) or stable (promote).
  --json                       Print machine-readable JSON.
  --help                       Show this help.
`;

function parseArgs(argv) {
  const args = { _: [], flags: new Map() };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a.startsWith("--")) {
      const key = a.slice(2);
      const eq = key.indexOf("=");
      if (eq >= 0) {
        args.flags.set(key.slice(0, eq), key.slice(eq + 1));
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        args.flags.set(key, argv[i + 1]);
        i += 1;
      } else {
        args.flags.set(key, "true");
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function defaultAllowlist(args) {
  return args.flags.get("allowlist") ?? resolve(REPO_ROOT, "release", "packages.json");
}

function manifestNotes(args) {
  return {
    changes: args.flags.get("changes") ?? "",
    configChanges: args.flags.get("config-changes") ?? "",
    upgrade: args.flags.get("upgrade") ?? "",
    rollback: args.flags.get("rollback") ?? "",
  };
}

function rawArtifactArgs(raw) {
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === "--artifact" && raw[i + 1]) out.push(raw[i + 1]);
    else if (raw[i].startsWith("--artifact=")) out.push(raw[i].slice("--artifact=".length));
  }
  return out;
}

function printViolations(violations) {
  for (const v of violations) {
    const loc = v.package ? `${v.package}:` : v.path ? `${v.path}:` : "";
    console.error(`  - ${v.kind} ${loc} ${v.reason ?? ""}`.trim());
  }
}

async function commandInspect(args) {
  const tgz = args._[1];
  if (!tgz) throw new ReleaseError("USAGE", "inspect requires a tarball path");
  const allowlist = loadAllowlist(defaultAllowlist(args));
  const result = inspectTgz(tgz, { allowlist });
  if (!result.ok) process.exitCode = 1;
  if (args.flags.has("json")) console.log(JSON.stringify(result, null, 2));
  else if (!result.ok) {
    console.error(`FAIL ${tgz}`);
    printViolations(result.violations);
  } else {
    const a = result.artifact;
    console.log(`OK ${a.name}@${a.version} payload=${a.payloadHash} db=${a.databaseContract?.version ?? "n/a"}`);
  }
}

async function commandManifest(args) {
  const allowlist = loadAllowlist(defaultAllowlist(args));
  const artifacts = [];
  for (const raw of rawArtifactArgs(args.raw ?? [])) {
    const eq = raw.indexOf("=");
    if (eq < 0) throw new ReleaseError("USAGE", `--artifact expects name=path, got ${raw}`);
    const name = raw.slice(0, eq);
    const tgzPath = raw.slice(eq + 1);
    const result = inspectTgz(tgzPath, { allowlist });
    if (!result.ok) {
      console.error(`FAIL ${tgzPath}`);
      printViolations(result.violations);
      process.exitCode = 1;
      continue;
    }
    artifacts.push({ name: result.artifact.name, version: result.artifact.version, tgzPath, artifact: result.artifact });
  }
  if (artifacts.length === 0) throw new ReleaseError("USAGE", "manifest requires at least one --artifact name=tgz");
  if (process.exitCode === 1) return;

  const closure = analyzeClosure(artifacts.map((x) => x.artifact));
  if (!closure.ok) {
    console.error("dependency closure problems:");
    printViolations(closure.violations);
    process.exitCode = 1;
    return;
  }

  const manifest = buildManifest({
    scope: allowlist.scope,
    sourceCommit: args.flags.get("source-commit"),
    channel: args.flags.get("channel") ?? "preview",
    artifacts,
    notes: manifestNotes(args),
  });
  const out = args.flags.get("out");
  if (out) writeFileSync(out, serializeManifest(manifest));
  else console.log(serializeManifest(manifest));
}

async function commandPrepareStable(args) {
  const preview = args._[1];
  const out = args.flags.get("out");
  const version = args.flags.get("version");
  if (!preview || !out || !version) throw new ReleaseError("USAGE", "prepare-stable needs <preview.tgz> --version X --out Y");
  let internalVersions = {};
  if (args.flags.get("internal-versions")) internalVersions = JSON.parse(args.flags.get("internal-versions"));
  const report = prepareStableTgz({ previewTgzPath: preview, outTgzPath: out, version, internalVersions });
  if (!report.ok) process.exitCode = 1;
  if (args.flags.has("json")) console.log(JSON.stringify(report, null, 2));
  else if (report.ok) console.log(`OK ${report.name}@${report.version} -> ${report.outTgzPath} ${report.sri}`);
  else {
    console.error(`PAYLOAD-DIFF ${report.outTgzPath}`);
    printViolations(report.differingPayload.map((d) => ({ kind: "payload-diff", path: d.path, reason: d.reason })));
  }
}

function resolveTarballFor(manifestPath) {
  const base = dirname(resolve(manifestPath));
  return (p) => resolve(base, p);
}

async function commandPublishLocal(args) {
  const manifestPath = args._[1];
  if (!manifestPath) throw new ReleaseError("USAGE", "publish-local needs <manifest.json>");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const registry = validateLoopbackRegistry(args.flags.get("registry"));
  const tag = args.flags.get("tag") ?? "candidate";
  const allowlist = loadAllowlist(defaultAllowlist(args));
  checkNpmVersion(args.flags.get("npm") ?? "npm");
  await publishLocal({
    manifest,
    allowlist,
    registry,
    tag,
    authToken: args.flags.get("auth-token"),
    auth: args.flags.get("auth"),
    auditPath: args.flags.get("audit"),
    npmPath: args.flags.get("npm") ?? "npm",
    receiptsPath: args.flags.get("receipts"),
    resolveTarball: resolveTarballFor(manifestPath),
  });
  console.log("PUBLISHED");
}

async function commandVerifyLocal(args) {
  const manifestPath = args._[1];
  if (!manifestPath) throw new ReleaseError("USAGE", "verify-local needs <manifest.json>");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const registry = validateLoopbackRegistry(args.flags.get("registry"));
  const receiptsPath = args.flags.get("receipts");
  const baselines = {};
  if (receiptsPath) {
    const saved = JSON.parse(readFileSync(receiptsPath, "utf8"));
    for (const [name, rec] of Object.entries(saved.packages ?? {})) {
      baselines[name] = rec.baseline ?? {};
    }
  }
  const receipts = await verifyLocal({ manifest, registry, baselines });
  const out = { schemaVersion: 1, manifestHash: manifest.manifestHash, registry, tag: "candidate", packages: {} };
  for (const r of receipts) out.packages[r.name] = { version: r.version, integrity: r.integrity, size: r.size };
  if (args.flags.has("json")) console.log(JSON.stringify(out, null, 2));
  else for (const r of receipts) console.log(`OK ${r.name}@${r.version} ${r.integrity}`);
}

async function commandPromoteLocal(args) {
  const manifestPath = args._[1];
  if (!manifestPath) throw new ReleaseError("USAGE", "promote-local needs <manifest.json>");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const registry = validateLoopbackRegistry(args.flags.get("registry"));
  const receipts = JSON.parse(readFileSync(args.flags.get("receipts"), "utf8"));
  const gatePath = args.flags.get("gate");
  if (!gatePath) throw new ReleaseError("USAGE", "promote-local needs --gate");
  const gate = JSON.parse(readFileSync(gatePath, "utf8"));
  const stableManifestPath = args.flags.get("stable-manifest");
  if (!stableManifestPath) throw new ReleaseError("USAGE", "promote-local needs --stable-manifest");
  checkNpmVersion(args.flags.get("npm") ?? "npm");
  const gateDir = dirname(resolve(gatePath));
  const readEvidence = (p) => readFileSync(resolve(gateDir, p));
  const result = await promoteRelease({
    manifest,
    registry,
    receipts,
    gate,
    stableManifestPath,
    stableTag: args.flags.get("tag") ?? "stable",
    authToken: args.flags.get("auth-token"),
    auth: args.flags.get("auth"),
    auditPath: args.flags.get("audit"),
    npmPath: args.flags.get("npm") ?? "npm",
    readEvidence,
  });
  if (result.ok) console.log(`PROMOTED ${stableManifestPath}`);
  else {
    console.error("promotion incomplete");
    process.exitCode = 1;
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  args.raw = argv;
  if (args.help || args._.length === 0) {
    console.log(HELP);
    return 0;
  }
  const command = args._[0];
  const handlers = {
    inspect: commandInspect,
    manifest: commandManifest,
    "prepare-stable": commandPrepareStable,
    "publish-local": commandPublishLocal,
    "verify-local": commandVerifyLocal,
    "promote-local": commandPromoteLocal,
  };
  if (!handlers[command]) {
    console.error(`unknown command: ${command}\n`);
    console.log(HELP);
    return 2;
  }
  try {
    await handlers[command](args);
  } catch (err) {
    if (err instanceof ReleaseError) {
      console.error(`[${err.code}] ${err.message}`);
      return 1;
    }
    throw err;
  }
  return process.exitCode ?? 0;
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
