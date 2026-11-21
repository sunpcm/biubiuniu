import { readFileSync } from "node:fs";

import { ReleaseError, ERROR_CODES } from "./errors.mjs";

const SCOPED_NAME_RE = /^@[^/]+\/[^/]+$/;

function normalizeRelativePath(path) {
  if (typeof path !== "string" || path.length === 0) return null;
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return null;
  const parts = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") return null;
    parts.push(seg);
  }
  return parts.join("/");
}

/**
 * Validate the release allowlist document produced by the packaging lane.
 * Fixed contract: `{ schemaVersion: 1, scope: "@sunpcm", packages: [{name,path}] }`.
 * Enforces the exact scope prefix (rejecting `@sunpcm-evil`), relative paths and
 * normalized-duplicate detection.
 */
export function validateAllowlist(doc, source = "release/packages.json") {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new ReleaseError(ERROR_CODES.CONFIG, `${source}: expected an object`, { source });
  }
  if (doc.schemaVersion !== 1) {
    throw new ReleaseError(
      ERROR_CODES.CONFIG,
      `${source}: unsupported schemaVersion ${JSON.stringify(doc.schemaVersion)}`,
      { source, schemaVersion: doc.schemaVersion },
    );
  }
  if (typeof doc.scope !== "string" || !/^@[^/]+$/.test(doc.scope)) {
    throw new ReleaseError(ERROR_CODES.CONFIG, `${source}: scope must be a scoped name like @sunpcm`, {
      source,
    });
  }
  if (!Array.isArray(doc.packages) || doc.packages.length === 0) {
    throw new ReleaseError(ERROR_CODES.CONFIG, `${source}: packages must be a non-empty array`, {
      source,
    });
  }

  const byName = new Map();
  const seenPaths = new Map();
  for (const entry of doc.packages) {
    if (!entry || typeof entry.name !== "string" || typeof entry.path !== "string") {
      throw new ReleaseError(ERROR_CODES.CONFIG, `${source}: each package needs {name, path}`, {
        source,
        entry,
      });
    }
    if (!SCOPED_NAME_RE.test(entry.name)) {
      throw new ReleaseError(ERROR_CODES.CONFIG, `${source}: invalid package name ${entry.name}`, {
        source,
        entry,
      });
    }
    // Reject names like `@sunpcm-evil` by requiring the exact `scope/` prefix.
    if (!entry.name.startsWith(`${doc.scope}/`)) {
      throw new ReleaseError(
        ERROR_CODES.CONFIG,
        `${source}: ${entry.name} is outside scope ${doc.scope}`,
        { source, entry },
      );
    }
    const normalizedPath = normalizeRelativePath(entry.path);
    if (normalizedPath === null) {
      throw new ReleaseError(
        ERROR_CODES.CONFIG,
        `${source}: ${entry.name} has a non-relative path ${JSON.stringify(entry.path)}`,
        { source, entry },
      );
    }
    if (byName.has(entry.name)) {
      throw new ReleaseError(ERROR_CODES.CONFIG, `${source}: duplicate package ${entry.name}`, {
        source,
        entry,
      });
    }
    if (seenPaths.has(normalizedPath)) {
      throw new ReleaseError(
        ERROR_CODES.CONFIG,
        `${source}: duplicate normalized path ${normalizedPath}`,
        { source, entry, previous: seenPaths.get(normalizedPath) },
      );
    }
    byName.set(entry.name, entry);
    seenPaths.set(normalizedPath, entry.name);
  }

  return {
    schemaVersion: doc.schemaVersion,
    scope: doc.scope,
    packages: [...doc.packages],
    byName,
  };
}

export function loadAllowlist(filePath) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    throw new ReleaseError(ERROR_CODES.CONFIG, `cannot read allowlist ${filePath}: ${err.message}`, {
      filePath,
    });
  }
  return validateAllowlist(doc, filePath);
}

export function allowlistNames(allowlist) {
  return allowlist.packages.map((p) => p.name);
}
