import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";

import { stableJson, sha256Hex, sriFromHex, deepEqual } from "./util.mjs";
import { isStableVersion } from "./semver.mjs";
import { inspectTgz, analyzeClosure } from "./inspect.mjs";
import { manifestHashOf, withChannel } from "./manifest.mjs";
import { validateGate, missingPackages } from "./promote.mjs";
import {
  validateLoopbackRegistry,
  publishOne,
  distTagOne,
  queryRemoteVersion,
  readAndVerifyTarball,
  verifyOneLocal,
  verifyLocal,
  readPackageMetadata,
  assertExpectedDistTag,
} from "./local-registry.mjs";
import { ReleaseError, ERROR_CODES } from "./errors.mjs";

const PUBLISH_TAGS = new Set(["candidate", "next"]);
const SOURCE_COMMIT_RE = /^[0-9a-f]{40}$/i;

export function verifyManifestDocument(manifest) {
  const reasons = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { ok: false, reasons: ["manifest is not an object"] };
  }
  if (manifest.schemaVersion !== 1) reasons.push("manifest.schemaVersion must be 1");
  if (manifest.kind !== "release") reasons.push("manifest.kind must be 'release'");
  if (typeof manifest.scope !== "string" || !/^@[^/]+$/.test(manifest.scope)) reasons.push("manifest.scope must be a scoped name");
  if (typeof manifest.channel !== "string") reasons.push("manifest.channel must be a string");
  if (typeof manifest.sourceCommit !== "string" || !SOURCE_COMMIT_RE.test(manifest.sourceCommit)) {
    reasons.push("manifest.sourceCommit must be a 40-hex caller-bound string");
  }
  if (typeof manifest.manifestHash !== "string") reasons.push("manifest.manifestHash is missing");
  else if (manifestHashOf(manifest) !== manifest.manifestHash) reasons.push("manifest.manifestHash does not match manifest content");
  if (!manifest.packages || typeof manifest.packages !== "object" || Object.keys(manifest.packages).length === 0) {
    reasons.push("manifest.packages must be non-empty");
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Full preflight before any subprocess or HTTP: manifest document/self-hash,
 * every actual tarball digest/identity/allowlist/inspect, and closure.
 */
export function preflightRelease({ manifest, allowlist, resolveTarball = (p) => p }) {
  const reasons = [];
  reasons.push(...verifyManifestDocument(manifest).reasons);

  if (allowlist && manifest.scope !== allowlist.scope) {
    reasons.push(`manifest scope ${manifest.scope} does not match allowlist scope ${allowlist.scope}`);
  }

  const packages = manifest.packages;
  if (!packages || typeof packages !== "object" || Array.isArray(packages)) {
    return { ok: false, reasons, artifacts: [], order: [] };
  }

  const artifacts = [];
  const seen = new Set();
  for (const [name, entry] of Object.entries(packages).sort(([a], [b]) => a.localeCompare(b))) {
    if (seen.has(name)) {
      reasons.push(`duplicate package ${name}`);
      continue;
    }
    seen.add(name);
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      reasons.push(`package ${name} entry is not an object`);
      continue;
    }
    if (entry.name !== name) reasons.push(`package key ${name} does not match entry.name ${entry.name}`);
    if (typeof entry.version !== "string") reasons.push(`package ${name} has no valid version`);
    if (typeof entry.tarball !== "string") reasons.push(`package ${name} has no tarball path`);
    if (typeof entry.sha256 !== "string") reasons.push(`package ${name} has no sha256`);
    if (typeof entry.sri !== "string") reasons.push(`package ${name} has no sri`);

    const tarball = resolveTarball(entry.tarball);
    let bytes;
    try {
      bytes = readFileSync(tarball);
    } catch (err) {
      reasons.push(`cannot read tarball ${entry.name}: ${err.message}`);
      continue;
    }
    const actualSha = sha256Hex(bytes);
    if (actualSha !== entry.sha256) reasons.push(`tarball sha256 mismatch for ${name}`);
    if (sriFromHex(actualSha) !== entry.sri) reasons.push(`tarball sri mismatch for ${name}`);

    const result = inspectTgz(tarball, { allowlist });
    if (!result.ok) {
      for (const v of result.violations) reasons.push(`${name}: ${v.kind} ${v.reason ?? ""}`.trim());
      continue;
    }
    const artifact = result.artifact;
    if (artifact.name !== name || artifact.version !== entry.version) {
      reasons.push(`${name}: tarball identity/version does not match manifest`);
    }
    if (artifact.payloadHash !== entry.payloadHash) {
      reasons.push(`${name}: payloadHash mismatch (manifest ${entry.payloadHash} != tarball ${artifact.payloadHash})`);
    }
    if (!deepEqual(artifact.databaseContract, entry.databaseContract ?? null)) {
      reasons.push(`${name}: databaseContract mismatch`);
    }
    if (!deepEqual(artifact.dependencies ?? {}, entry.dependencies ?? {})) {
      reasons.push(`${name}: dependencies mismatch`);
    }
    if (!deepEqual(artifact.peerDependencies ?? {}, entry.peerDependencies ?? {})) {
      reasons.push(`${name}: peerDependencies mismatch`);
    }
    if (!deepEqual(artifact.optionalDependencies ?? {}, entry.optionalDependencies ?? {})) {
      reasons.push(`${name}: optionalDependencies mismatch`);
    }
    artifacts.push(artifact);
  }

  const closure = analyzeClosure(artifacts);
  for (const v of closure.violations) reasons.push(`closure: ${v.kind} ${v.package ?? ""} ${v.dep ?? ""} ${v.spec ?? v.actual ?? ""}`.trim());

  return { ok: reasons.length === 0, reasons, artifacts, order: closure.order };
}

function readReceipts(receiptsPath, manifest, registry, fs) {
  if (!receiptsPath || !fs.existsSync(receiptsPath)) {
    return { schemaVersion: 1, manifestHash: manifest.manifestHash, registry, tag: "candidate", packages: {} };
  }
  const receipts = JSON.parse(fs.readFileSync(receiptsPath, "utf8"));
  if (receipts.manifestHash !== manifest.manifestHash) {
    throw new ReleaseError(ERROR_CODES.REGISTRY, "receipts belong to a different manifest");
  }
  if (receipts.registry && receipts.registry !== registry) {
    throw new ReleaseError(ERROR_CODES.REGISTRY, "receipts belong to a different registry");
  }
  return receipts;
}

function atomicWriteJson(fs, filePath, value) {
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${stableJson(value)}\n`);
  fs.renameSync(tmp, filePath);
}

/**
 * Publish a manifest to a loopback registry in topological order. Every package
 * is checked against remote state first; a matching existing version is reused
 * (verified by digest), a conflict fails, and a missing version is published and
 * then read back before its receipt is persisted atomically.
 */
export async function publishLocal({
  manifest,
  allowlist,
  registry,
  tag = "candidate",
  authToken,
  auth,
  auditPath,
  npmPath = "npm",
  receiptsPath,
  resolveTarball = (p) => p,
  runner,
  fetchFn = fetch,
  fs = { readFileSync, writeFileSync, renameSync, existsSync },
}) {
  if (!PUBLISH_TAGS.has(tag)) {
    throw new ReleaseError(ERROR_CODES.REGISTRY, `publish tag must be one of ${[...PUBLISH_TAGS].join(", ")}, got ${tag}`);
  }
  validateLoopbackRegistry(registry);
  const preflight = preflightRelease({ manifest, allowlist, resolveTarball });
  if (!preflight.ok) {
    throw new ReleaseError(ERROR_CODES.REGISTRY, `preflight failed: ${preflight.reasons.join("; ")}`, { reasons: preflight.reasons });
  }

  const receipts = readReceipts(receiptsPath, manifest, registry, fs);
  const order = preflight.order;

  for (const name of order) {
    const entry = manifest.packages[name];
    const tarball = resolveTarball(entry.tarball);

    const remote = await queryRemoteVersion({ name: entry.name, version: entry.version, registry, fetchFn });
    const saved = receipts.packages[name];
    const baseline = saved?.baseline !== undefined ? saved.baseline : (remote.distTags ?? {});

    if (remote.found) {
      // Existing exact version: verify its actual tarball AND the selected tag
      // still points at it (reuse must not skip tag verification). Resume uses
      // the persisted baseline, never current tags rebuilt as a fresh baseline.
      await readAndVerifyTarball({
        tarballUrl: remote.meta.tarballUrl,
        sha256: entry.sha256,
        sri: entry.sri,
        name: entry.name,
        version: entry.version,
        integrity: remote.meta.integrity,
        registry,
        fetchFn,
      });
      assertExpectedDistTag({ name: entry.name, version: entry.version, tag, distTags: remote.distTags, baseline });
    } else {
      // Persist the known baseline and the pending step before any side effect,
      // so a crash can resume from remote truth instead of a fabricated receipt.
      if (receiptsPath) {
        receipts.packages[name] = {
          version: entry.version,
          integrity: entry.sri,
          size: null,
          status: "pending",
          baseline,
        };
        atomicWriteJson(fs, receiptsPath, receipts);
      }
      const pub = publishOne({ tgzPath: tarball, registry, tag, scope: manifest.scope, authToken, auth, auditPath, npmPath, runner });
      if (!pub.ok) {
        throw new ReleaseError(ERROR_CODES.REGISTRY, `publish ${entry.name}@${entry.version} failed: ${pub.stderr || pub.stdout}`);
      }
      await verifyOneLocal({ entry, registry, tag, baseline, fetchFn });
    }

    receipts.packages[name] = {
      version: entry.version,
      integrity: entry.sri,
      size: null,
      status: "verified",
      baseline,
    };
    if (receiptsPath) atomicWriteJson(fs, receiptsPath, receipts);
  }

  if (receiptsPath) atomicWriteJson(fs, receiptsPath, receipts);
  return receipts;
}

/**
 * Local promotion: re-verify the current registry, require a bound consumer
 * gate, require stable semver, move the `stable` dist-tag per package on the
 * loopback, then atomically replace the stable manifest (preserving the old).
 */
export async function promoteRelease({
  manifest,
  registry,
  receipts,
  gate,
  stableManifestPath,
  stableTag = "stable",
  authToken,
  auth,
  auditPath,
  npmPath = "npm",
  runner,
  fetchFn = fetch,
  fs = { readFileSync, writeFileSync, renameSync, existsSync },
  readEvidence,
}) {
  validateLoopbackRegistry(registry);
  if (stableTag !== "stable") {
    throw new ReleaseError(ERROR_CODES.PROMOTE, `stable tag must be 'stable', got ${stableTag}`);
  }
  const doc = verifyManifestDocument(manifest);
  if (!doc.ok) {
    throw new ReleaseError(ERROR_CODES.PROMOTE, `manifest invalid: ${doc.reasons.join("; ")}`);
  }
  if (manifest.channel === "stable") {
    throw new ReleaseError(ERROR_CODES.PROMOTE, "manifest is already stable");
  }
  for (const entry of Object.values(manifest.packages)) {
    if (!isStableVersion(entry.version)) {
      throw new ReleaseError(ERROR_CODES.PROMOTE, `cannot promote prerelease ${entry.name}@${entry.version} to stable`);
    }
  }
  if (!receipts || typeof receipts !== "object" || Array.isArray(receipts)) {
    throw new ReleaseError(ERROR_CODES.PROMOTE, "receipts are missing");
  }
  if (receipts.schemaVersion !== 1) {
    throw new ReleaseError(ERROR_CODES.PROMOTE, "receipts schemaVersion must be 1");
  }
  if (receipts.manifestHash !== manifest.manifestHash) {
    throw new ReleaseError(ERROR_CODES.PROMOTE, "receipts do not match manifest");
  }
  if (receipts.registry !== registry) {
    throw new ReleaseError(ERROR_CODES.PROMOTE, "receipts belong to a different registry");
  }
  if (receipts.tag !== "candidate") {
    throw new ReleaseError(ERROR_CODES.PROMOTE, `receipts tag must be candidate, got ${receipts.tag}`);
  }
  const missing = missingPackages({ manifest, receipts });
  if (missing.length > 0) {
    throw new ReleaseError(ERROR_CODES.PROMOTE, `receipts are incomplete for: ${missing.join(", ")}`);
  }
  for (const name of Object.keys(manifest.packages).sort()) {
    const rec = receipts.packages[name];
    if (rec.status !== "verified") {
      throw new ReleaseError(ERROR_CODES.PROMOTE, `package ${name} receipt is not verified (status=${rec.status})`);
    }
    if (!rec.baseline || typeof rec.baseline !== "object") {
      throw new ReleaseError(ERROR_CODES.PROMOTE, `package ${name} receipt has no baseline`);
    }
  }

  const baselines = Object.fromEntries(
    Object.keys(manifest.packages).map((name) => [name, receipts.packages[name].baseline]),
  );
  const verified = await verifyLocal({ manifest, registry, tag: "candidate", baselines, fetchFn });
  const gateResult = validateGate({ manifest, gate, readEvidence });
  if (!gateResult.ok) {
    throw new ReleaseError(ERROR_CODES.GATE, `gate failed: ${gateResult.reasons.join("; ")}`, {
      reasons: gateResult.reasons,
    });
  }

  const tagResults = [];
  for (const name of Object.keys(manifest.packages).sort()) {
    const entry = manifest.packages[name];
    const res = distTagOne({ name: entry.name, version: entry.version, tag: stableTag, registry, scope: manifest.scope, authToken, auth, auditPath, npmPath, runner });
    tagResults.push({ name, ok: res.ok, stderr: res.stderr, stdout: res.stdout });
    if (!res.ok) {
      return { ok: false, incomplete: true, tagResults, promoted: false, previousManifest: null };
    }
    // Fail closed on the registry's actual tag state after the stable move.
    try {
      const meta = await readPackageMetadata({ name: entry.name, version: entry.version, registry, fetchFn });
      assertExpectedDistTag({
        name: entry.name,
        version: entry.version,
        tag: stableTag,
        distTags: meta.distTags,
        baseline: receipts.packages[name].baseline,
      });
    } catch (err) {
      return {
        ok: false,
        incomplete: true,
        tagResults,
        promoted: false,
        previousManifest: null,
        error: err instanceof ReleaseError ? err.message : String(err?.message ?? err),
      };
    }
  }

  const stableManifest = withChannel(manifest, "stable");
  const previousManifest = fs.existsSync(stableManifestPath)
    ? JSON.parse(fs.readFileSync(stableManifestPath, "utf8"))
    : null;
  if (previousManifest) fs.writeFileSync(`${stableManifestPath}.previous`, `${stableJson(previousManifest)}\n`);
  atomicWriteJson(fs, stableManifestPath, stableManifest);

  return { ok: true, incomplete: false, tagResults, promoted: true, previousManifest, verified };
}

export { verifyLocal };
