import { readFileSync, existsSync, lstatSync, realpathSync, linkSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

import { sha256Hex, sriFromHex, normalizeText } from "./util.mjs";
import { assertExactVersion, satisfies } from "./semver.mjs";
import { readTgz, readPackageJson, normalizedFileMap, stripPackagePrefix, createTgz } from "./tar.mjs";
import { ReleaseError, ERROR_CODES } from "./errors.mjs";

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepDiff(a, b, prefix = "") {
  const diffs = [];
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const key of [...keys].sort()) {
    const path = prefix ? `${prefix}.${key}` : key;
    const av = a?.[key];
    const bv = b?.[key];
    if (av && bv && typeof av === "object" && typeof bv === "object" && !Array.isArray(av) && !Array.isArray(bv)) {
      diffs.push(...deepDiff(av, bv, path));
    } else if (JSON.stringify(av) !== JSON.stringify(bv)) {
      diffs.push({ path, old: av, new: bv });
    }
  }
  return diffs;
}

function rewriteInternalVersions(json, internalVersions) {
  const out = deepClone(json);
  for (const field of ["dependencies", "optionalDependencies"]) {
    if (!out[field] || typeof out[field] !== "object") continue;
    for (const [dep, target] of Object.entries(internalVersions)) {
      if (out[field][dep] !== undefined) out[field][dep] = target;
    }
  }
  // Peers keep their existing API range when it already covers the target;
  // narrowing a peer range is an explicit contract change, never silent.
  if (out.peerDependencies && typeof out.peerDependencies === "object") {
    for (const [dep, target] of Object.entries(internalVersions)) {
      const current = out.peerDependencies[dep];
      if (current === undefined) continue;
      if (!satisfies(target, current)) {
        throw new ReleaseError(
          ERROR_CODES.STABLE,
          `peer range ${current} for ${dep} does not cover stable version ${target}`,
          { dep, current, target },
        );
      }
    }
  }
  return out;
}

function assertNewOutputPath(previewTgzPath, outTgzPath) {
  if (typeof outTgzPath !== "string" || outTgzPath.length === 0) {
    throw new ReleaseError(ERROR_CODES.STABLE, "stable output path is required");
  }
  const rawParts = outTgzPath.split("/");
  if (rawParts.some((seg) => seg === "..")) {
    throw new ReleaseError(ERROR_CODES.STABLE, `stable output must not contain .. segments: ${outTgzPath}`);
  }
  if (rawParts.some((seg) => seg === ".")) {
    throw new ReleaseError(ERROR_CODES.STABLE, `stable output must not contain . segments: ${outTgzPath}`);
  }
  const previewAbs = existsSync(previewTgzPath) ? realpathSync(previewTgzPath) : resolve(previewTgzPath);
  const outAbs = resolve(outTgzPath);

  if (existsSync(outTgzPath)) {
    const st = lstatSync(outTgzPath);
    if (st.isSymbolicLink() || st.nlink > 1) {
      throw new ReleaseError(ERROR_CODES.STABLE, `stable output must not be a link or hardlink: ${outTgzPath}`);
    }
    throw new ReleaseError(ERROR_CODES.STABLE, `stable output already exists: ${outTgzPath}`);
  }
  if (outAbs === previewAbs) {
    throw new ReleaseError(ERROR_CODES.STABLE, "stable output must not resolve to the preview tarball");
  }
  return outAbs;
}

/**
 * Promote a preview tarball to a stable tarball by changing only
 * `package.json.version` and this batch's internal strong/optional dependency
 * versions. Internal peer ranges are preserved when they already cover the
 * target. Re-packs without recompiling; every non-package.json member must
 * remain normalized-identical. The output must be a fresh, non-link, non-
 * pre-existing path that never overwrites the preview input.
 */
export function prepareStableTgz({ previewTgzPath, outTgzPath, version, internalVersions = {} }) {
  assertExactVersion(version, "stable version");
  for (const [name, v] of Object.entries(internalVersions)) assertExactVersion(v, `internal version for ${name}`);

  const outAbs = assertNewOutputPath(previewTgzPath, outTgzPath);
  const previewBytesBefore = readFileSync(previewTgzPath);
  const archive = readTgz(previewTgzPath);
  const { json: originalJson } = readPackageJson(archive.files);

  const rewritten = rewriteInternalVersions(originalJson, internalVersions);
  rewritten.version = version;

  const pkgDiff = deepDiff(originalJson, rewritten);
  const allowedPrefixes = ["version", "dependencies.", "optionalDependencies."];
  const unexpectedDiffs = pkgDiff.filter(
    (d) => !allowedPrefixes.some((p) => d.path === p || d.path.startsWith(p)),
  );
  if (unexpectedDiffs.length > 0) {
    throw new ReleaseError(
      ERROR_CODES.STABLE,
      `stable repack would change fields outside version/strong deps: ${unexpectedDiffs.map((d) => d.path).join(", ")}`,
      { unexpectedDiffs },
    );
  }

  const newPkgContent = Buffer.from(`${JSON.stringify(rewritten, null, 2)}\n`, "utf8");
  const entries = archive.entries.map((entry) => {
    if (stripPackagePrefix(entry.path) === "package.json" && entry.content !== null) {
      return { ...entry, content: newPkgContent };
    }
    return { ...entry };
  });

  // Atomic exclusive create: write to a unique same-directory temp file, then
  // hard-link it into place. link() is atomic and fails with EEXIST when the
  // target already exists, so a target that appears after assertNewOutputPath
  // cannot be overwritten (no check-then-rename TOCTOU).
  const tmp = `${outAbs}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  createTgz(entries, tmp);
  try {
    linkSync(tmp, outAbs);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {}
    if (err.code === "EEXIST") {
      throw new ReleaseError(ERROR_CODES.STABLE, `stable output already exists: ${outTgzPath}`);
    }
    throw err;
  }
  try {
    unlinkSync(tmp);
  } catch {}

  const originalFiles = normalizedFileMap(archive.files);
  const newArchive = readTgz(outAbs);
  const newFiles = normalizedFileMap(newArchive.files);
  const differingPayload = [];
  for (const [rel, originalContent] of originalFiles.entries()) {
    if (rel === "package.json") continue;
    const newContent = newFiles.get(rel);
    if (!newContent) differingPayload.push({ path: rel, reason: "missing in stable tarball" });
    else if (normalizeText(originalContent) !== normalizeText(newContent)) differingPayload.push({ path: rel, reason: "content changed" });
  }
  for (const rel of newFiles.keys()) {
    if (rel !== "package.json" && !originalFiles.has(rel)) differingPayload.push({ path: rel, reason: "unexpected new file" });
  }

  const previewBytesAfter = readFileSync(previewTgzPath);
  if (!previewBytesBefore.equals(previewBytesAfter)) {
    throw new ReleaseError(ERROR_CODES.STABLE, "preview tarball changed during stable repack");
  }

  const sha256 = sha256Hex(readFileSync(outAbs));
  return {
    ok: differingPayload.length === 0,
    name: originalJson.name,
    version,
    outTgzPath: outAbs,
    sha256,
    sri: sriFromHex(sha256),
    internalChanges: pkgDiff.map((d) => ({ path: d.path, old: d.old, new: d.new })),
    differingPayload,
  };
}
