import { readFileSync } from "node:fs";

import { sha256Hex, sriFromHex, stableJson, hashJson } from "./util.mjs";
import { ReleaseError, ERROR_CODES } from "./errors.mjs";
import { analyzeClosure } from "./inspect.mjs";

const SOURCE_COMMIT_RE = /^[0-9a-f]{40}$/i;

function tgzDigest(tgzPath) {
  let content;
  try {
    content = readFileSync(tgzPath);
  } catch (err) {
    throw new ReleaseError(ERROR_CODES.IO, `cannot read tarball ${tgzPath}: ${err.message}`, { tgzPath });
  }
  const hex = sha256Hex(content);
  return { sha256: hex, sri: sriFromHex(hex) };
}

function summarizeDatabaseContracts(artifacts) {
  const seen = new Map();
  for (const artifact of artifacts) {
    if (!artifact.databaseContract) continue;
    const key = `${artifact.databaseContract.version}:${(artifact.databaseContract.profiles ?? []).join(",")}`;
    if (!seen.has(key)) {
      seen.set(key, {
        version: artifact.databaseContract.version,
        profiles: artifact.databaseContract.profiles,
        packages: [],
      });
    }
    seen.get(key).packages.push(artifact.name);
  }
  return [...seen.values()];
}

function manifestWithoutHash(manifest) {
  const { manifestHash, ...rest } = manifest;
  return rest;
}

/**
 * Build a deterministic release manifest. The caller binds `sourceCommit` to
 * the reviewed source; this tool never invents a dirty worktree HEAD as the
 * provenance of an artifact.
 */
export function buildManifest({ scope, sourceCommit, channel = "preview", artifacts, notes = {} }) {
  if (!scope || !scope.startsWith("@")) {
    throw new ReleaseError(ERROR_CODES.MANIFEST, "manifest requires a scoped name");
  }
  if (sourceCommit === undefined) {
    throw new ReleaseError(
      ERROR_CODES.MANIFEST,
      "sourceCommit must be bound by the caller; refusing to infer it from a dirty worktree",
    );
  }
  if (typeof sourceCommit !== "string" || !SOURCE_COMMIT_RE.test(sourceCommit)) {
    throw new ReleaseError(ERROR_CODES.MANIFEST, "sourceCommit must be a 40-hex caller-bound string");
  }
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new ReleaseError(ERROR_CODES.MANIFEST, "manifest requires at least one artifact");
  }

  const sorted = [...artifacts].sort((a, b) => a.name.localeCompare(b.name));
  const seen = new Set();
  const packages = {};
  for (const { name, version, tgzPath, artifact } of sorted) {
    if (seen.has(name)) {
      throw new ReleaseError(ERROR_CODES.MANIFEST, `duplicate artifact for ${name}`);
    }
    seen.add(name);
    const digest = tgzDigest(tgzPath);
    packages[name] = {
      name,
      version,
      path: artifact.path,
      tarball: tgzPath,
      sha256: digest.sha256,
      sri: digest.sri,
      dependencies: artifact.dependencies ?? {},
      peerDependencies: artifact.peerDependencies ?? {},
      optionalDependencies: artifact.optionalDependencies ?? {},
      payloadHash: artifact.payloadHash,
      databaseContract: artifact.databaseContract,
    };
  }

  const databaseContractScope = summarizeDatabaseContracts(sorted.map((x) => x.artifact));

  const manifest = {
    schemaVersion: 1,
    kind: "release",
    scope,
    channel,
    sourceCommit,
    packages,
    databaseContractScope,
    notes: {
      changes: notes.changes ?? "",
      configChanges: notes.configChanges ?? "",
      upgrade: notes.upgrade ?? "",
      rollback: notes.rollback ?? "",
    },
  };

  manifest.manifestHash = hashJson(manifestWithoutHash(manifest));
  return manifest;
}

export function serializeManifest(manifest) {
  return `${stableJson(manifest)}\n`;
}

/** Return a copy of the manifest with a new channel and a fresh self-hash. */
export function withChannel(manifest, channel) {
  const next = { ...manifest, channel };
  next.manifestHash = hashJson(manifestWithoutHash(next));
  return next;
}

export function manifestHashOf(manifest) {
  return hashJson(manifestWithoutHash(manifest));
}

/** Re-verify each manifest entry against its tarball on disk. */
export function verifyManifestArtifacts(manifest, { resolveTarball = (p) => p } = {}) {
  const problems = [];
  for (const [name, entry] of Object.entries(manifest.packages)) {
    const path = resolveTarball(entry.tarball);
    let digest;
    try {
      digest = tgzDigest(path);
    } catch (err) {
      problems.push({ package: name, reason: err.message });
      continue;
    }
    if (digest.sha256 !== entry.sha256) {
      problems.push({
        package: name,
        reason: `tarball sha256 mismatch: expected ${entry.sha256}, got ${digest.sha256}`,
      });
    }
    if (digest.sri !== entry.sri) {
      problems.push({ package: name, reason: `tarball sri mismatch: expected ${entry.sri}, got ${digest.sri}` });
    }
  }
  return problems;
}

export { analyzeClosure };
