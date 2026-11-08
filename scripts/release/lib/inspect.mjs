import { sha256Hex, normalizeText } from "./util.mjs";
import { valid, validRange, eq, satisfies } from "./semver.mjs";
import { readTgz, readPackageJson, normalizedFileMap, stripPackagePrefix } from "./tar.mjs";

const FORBIDDEN_DEP_PROTOCOLS = ["workspace:", "catalog:", "link:", "file:", "portal:", "patch:"];

// Provider/channel SDKs that must never be forced onto a consumer that did not
// select that channel. They belong in peer/optional peer, never hard deps.
const PROVIDER_SDKS = new Set(["stripe", "creem", "paypal", "@google/genai"]);

const SENSITIVE_PATH_RE =
  /(^|\/)(\.env(\..*)?|\.npmrc|\.git|node_modules|\.turbo|\.cache|coverage|\.nyc_output)(\/|$)/;
const SENSITIVE_BASENAME_RE =
  /(^|\.)(pem|p12|pfx|key|key\.pub)$|(^|\.)(log|bak|tmp|swp)$|(^|~)$|^\.DS_Store$|^id_(rsa|dsa|ecdsa|ed25519)$|secret|token|credential/i;

const PAYLOAD_EXTS = new Set([".js", ".mjs", ".cjs", ".css", ".sql"]);

function isPayloadPath(rel) {
  if (rel.endsWith(".d.ts")) return true;
  if (rel.endsWith(".d.ts.map") || rel.endsWith(".js.map") || rel.endsWith(".mjs.map")) return false;
  const dot = rel.lastIndexOf(".");
  if (dot < 0) return false;
  return PAYLOAD_EXTS.has(rel.slice(dot));
}

function isSensitivePath(rel) {
  const base = rel.split("/").pop();
  return SENSITIVE_PATH_RE.test(rel) || SENSITIVE_BASENAME_RE.test(base);
}

function isSafeRelativePath(path) {
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return false;
  return !path.split("/").includes("..");
}

function sourceAliasesIn(text) {
  const hits = [];
  const re = /(?:from\s+|import\s*\(|require\s*\(\s*)["'](@\/[^"']+|@source\/?[^"']*)["']/g;
  let m;
  while ((m = re.exec(text)) !== null) if (!hits.includes(m[1])) hits.push(m[1]);
  return hits;
}

function absolutePathsIn(text) {
  const hits = [];
  const re = /["'](\/(?:Users|home|root|tmp|var|etc|opt|usr|private|Volumes|workspaces)\/[^"']*|[A-Za-z]:\\[^"']*)["']/g;
  let m;
  while ((m = re.exec(text)) !== null) if (!hits.includes(m[1])) hits.push(m[1]);
  return hits;
}

function productEnvIn(text) {
  const hits = [];
  const re = /process\s*\.\s*env\s*\.\s*(NEXT_PUBLIC_[A-Z0-9_]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) if (!hits.includes(m[1])) hits.push(m[1]);
  return hits;
}

function depFields(json) {
  return {
    dependencies: json.dependencies ?? {},
    peerDependencies: json.peerDependencies ?? {},
    optionalDependencies: json.optionalDependencies ?? {},
    devDependencies: json.devDependencies ?? {},
    peerDependenciesMeta: json.peerDependenciesMeta ?? {},
  };
}

function forbiddenSpecifier(value) {
  if (typeof value !== "string") return null;
  for (const proto of FORBIDDEN_DEP_PROTOCOLS) if (value.startsWith(proto)) return proto;
  return null;
}

function isInternalName(name, allowlist) {
  return allowlist.byName.has(name);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(pattern) {
  let out = "^";
  for (const ch of pattern) out += ch === "*" ? ".*" : escapeRegExp(ch);
  return new RegExp(`${out}$`);
}

function stripDotSlash(p) {
  return p.startsWith("./") ? p.slice(2) : p;
}

function exportTargets(exportsField) {
  const out = [];
  const push = (target) => {
    if (typeof target === "string" && !target.includes("#")) out.push(target);
  };
  if (typeof exportsField === "string") {
    push(exportsField);
  } else if (exportsField && typeof exportsField === "object" && !Array.isArray(exportsField)) {
    for (const [key, value] of Object.entries(exportsField)) {
      if (!key.startsWith(".")) continue;
      if (typeof value === "string") push(value);
      else if (value && typeof value === "object") {
        for (const cond of ["types", "import", "require", "default", "node", "browser", "style"]) {
          push(value[cond]);
        }
      }
    }
  }
  return out;
}

/** Return export targets that do not resolve to any archive member. */
function missingExportTargets(exportsField, normalized) {
  const missing = [];
  for (const target of exportTargets(exportsField)) {
    const clean = stripDotSlash(target);
    if (clean.includes("*")) {
      const re = globToRegex(clean);
      if (![...normalized.keys()].some((p) => re.test(p))) {
        missing.push(target);
      }
    } else if (!normalized.has(clean)) {
      missing.push(target);
    }
  }
  return missing;
}

function balancedExtract(text, openBraceIndex) {
  let depth = 0;
  for (let i = openBraceIndex; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(openBraceIndex + 1, i);
    }
  }
  return null;
}

export function detectDatabaseContract(normalizedFiles) {
  for (const [rel, content] of normalizedFiles.entries()) {
    if (!rel.endsWith(".js") && !rel.endsWith(".mjs") && !rel.endsWith(".d.ts")) continue;
    const text = content.toString("utf8");
    const vm = /\bDATABASE_CONTRACT_VERSION\s*=\s*(\d+)/.exec(text);
    if (!vm) continue;
    let profiles = [];
    const pm = /\bPROFILES\s*[:=]\s*\{/.exec(text);
    if (pm) {
      const body = balancedExtract(text, pm.index + pm[0].length - 1);
      if (body) profiles = [...body.matchAll(/name\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
    }
    return { version: Number(vm[1]), profiles: [...new Set(profiles)] };
  }
  return null;
}

export function computePayloadHash(normalizedFiles) {
  const payload = [];
  for (const [rel, content] of normalizedFiles.entries()) {
    if (!isPayloadPath(rel)) continue;
    payload.push({ path: rel, content });
  }
  payload.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const perFile = payload.map((f) => ({ path: f.path, sha256: sha256Hex(normalizeText(f.content)) }));
  return { payloadHash: sha256Hex(perFile.map((f) => `${f.path}\0${f.sha256}`).join("\0")), payloadFiles: perFile };
}

/**
 * Verify a single already-reviewed tarball against the allowlist and the
 * publish contract. Returns `{ ok, violations, artifact }`; never throws for
 * verification findings (so callers can aggregate and report all of them).
 */
export function inspectTgz(tgzPath, { allowlist, packagePath }) {
  const violations = [];
  let archive;
  try {
    archive = readTgz(tgzPath);
  } catch (err) {
    return { ok: false, violations: [{ kind: "tar-read", path: tgzPath, reason: err.message }], artifact: null };
  }

  const seen = new Map();
  for (const entry of archive.entries) {
    if (seen.has(entry.path)) violations.push({ kind: "duplicate-member", path: entry.path });
    seen.set(entry.path, entry);
    if (!isSafeRelativePath(entry.path)) violations.push({ kind: "absolute-or-escape-path", path: entry.path });
    if (entry.type === "2") violations.push({ kind: "symlink", path: entry.path, reason: `symlink to ${entry.linkname}` });
    if (entry.type === "1") violations.push({ kind: "hardlink", path: entry.path, reason: `hardlink to ${entry.linkname}` });
    if (isSensitivePath(stripPackagePrefix(entry.path))) violations.push({ kind: "sensitive-file", path: entry.path });
  }

  let pkgJson;
  try {
    pkgJson = readPackageJson(archive.files).json;
  } catch (err) {
    violations.push({ kind: "package-json", path: "package.json", reason: err.message });
    return { ok: false, violations, artifact: null };
  }

  const name = typeof pkgJson.name === "string" ? pkgJson.name : null;
  const version = typeof pkgJson.version === "string" ? pkgJson.version : null;

  if (!name) violations.push({ kind: "package-name", reason: "package.json has no name" });
  else if (!allowlist.byName.has(name)) {
    violations.push({ kind: "allowlist", name, reason: `name is not in the release allowlist (${allowlist.scope})` });
  }

  if (!version) violations.push({ kind: "package-version", reason: "package.json has no version" });
  else if (valid(version) === null) violations.push({ kind: "package-version", version, reason: "version is not valid semver" });

  const fields = depFields(pkgJson);

  for (const fieldName of ["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"]) {
    for (const [depName, spec] of Object.entries(fields[fieldName])) {
      const proto = forbiddenSpecifier(spec);
      if (proto) {
        violations.push({ kind: "forbidden-dep-protocol", field: fieldName, dep: depName, spec, reason: `${fieldName}.${depName} uses forbidden ${proto} protocol` });
      }
    }
  }

  const internalDeps = [];
  for (const fieldName of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [depName, spec] of Object.entries(fields[fieldName])) {
      if (!isInternalName(depName, allowlist)) continue;
      internalDeps.push({ field: fieldName, name: depName, spec });
      // Strong and optional internal deps must be exact; internal peers may
      // carry a legal API range and are satisfied-checked at closure time.
      if (fieldName === "dependencies" || fieldName === "optionalDependencies") {
        if (valid(spec) === null) {
          violations.push({ kind: "internal-dep-not-exact", field: fieldName, dep: depName, spec, reason: `internal ${fieldName} ${depName} is not an exact version (${spec})` });
        }
      } else if (fieldName === "peerDependencies" && validRange(spec) === null) {
        violations.push({ kind: "internal-peer-invalid-range", field: fieldName, dep: depName, spec, reason: `internal peer ${depName} has an invalid range (${spec})` });
      }
    }
  }

  for (const sdk of PROVIDER_SDKS) {
    if (fields.dependencies[sdk] !== undefined) {
      violations.push({ kind: "provider-sdk-hard-dep", dep: sdk, reason: `provider SDK ${sdk} must be an optional peer, not a hard dependency` });
    }
    if (fields.peerDependencies[sdk] !== undefined && fields.peerDependenciesMeta[sdk]?.optional !== true) {
      violations.push({ kind: "provider-sdk-required-peer", dep: sdk, reason: `provider SDK ${sdk} peer must be marked optional` });
    }
  }

  const normalized = normalizedFileMap(archive.files);
  for (const target of missingExportTargets(pkgJson.exports, normalized)) {
    violations.push({ kind: "missing-export-target", target, reason: `exports target ${target} is not in the tarball` });
  }

  for (const [rel, content] of normalized.entries()) {
    if (!rel.endsWith(".js") && !rel.endsWith(".mjs") && !rel.endsWith(".cjs") && !rel.endsWith(".d.ts")) continue;
    const text = content.toString("utf8");
    for (const alias of sourceAliasesIn(text)) violations.push({ kind: "source-alias", file: rel, alias });
    for (const abs of absolutePathsIn(text)) violations.push({ kind: "absolute-path", file: rel, path: abs });
    for (const env of productEnvIn(text)) violations.push({ kind: "product-env", file: rel, env });
  }

  const databaseContract = detectDatabaseContract(normalized);
  const { payloadHash, payloadFiles } = computePayloadHash(normalized);

  const artifact = {
    name,
    version,
    path: packagePath ?? allowlist.byName.get(name)?.path ?? null,
    tgzPath,
    packageJson: pkgJson,
    dependencies: fields.dependencies,
    peerDependencies: fields.peerDependencies,
    optionalDependencies: fields.optionalDependencies,
    peerDependenciesMeta: fields.peerDependenciesMeta,
    internalDeps,
    payloadHash,
    payloadFiles,
    databaseContract,
  };

  return { ok: violations.length === 0, violations, artifact };
}

/**
 * Verify the internal dependency closure across a full set of artifacts using
 * real semver. Strong/optional internal deps must resolve to the exact version
 * present in the set; internal peers must be satisfied by that exact version.
 * Returns a leaves-first topological publish order over strong/optional edges.
 */
export function analyzeClosure(artifacts) {
  const byName = new Map(artifacts.map((a) => [a.name, { version: a.version }]));
  const violations = [];

  for (const artifact of artifacts) {
    for (const dep of artifact.internalDeps) {
      if (!byName.has(dep.name)) {
        violations.push({ kind: "missing-internal", package: artifact.name, dep: dep.name });
        continue;
      }
      const targetVersion = byName.get(dep.name).version;
      if (dep.field === "dependencies" || dep.field === "optionalDependencies") {
        if (!eq(dep.spec, targetVersion)) {
          violations.push({
            kind: "internal-version-mismatch",
            package: artifact.name,
            dep: dep.name,
            spec: dep.spec,
            actual: targetVersion,
          });
        }
      } else if (dep.field === "peerDependencies") {
        if (!satisfies(targetVersion, dep.spec)) {
          violations.push({
            kind: "internal-peer-unsatisfied",
            package: artifact.name,
            dep: dep.name,
            spec: dep.spec,
            actual: targetVersion,
          });
        }
      }
    }
  }

  const order = [];
  const visiting = new Set();
  const visited = new Set();
  function visit(name, stack) {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      violations.push({ kind: "dependency-cycle", package: name, stack: [...stack, name] });
      return;
    }
    visiting.add(name);
    const artifact = artifacts.find((a) => a.name === name);
    for (const dep of artifact.internalDeps) {
      if ((dep.field === "dependencies" || dep.field === "optionalDependencies") && byName.has(dep.name)) {
        visit(dep.name, [...stack, name]);
      }
    }
    visiting.delete(name);
    visited.add(name);
    order.push(name);
  }
  for (const name of byName.keys()) visit(name, []);

  return { ok: violations.length === 0, violations, order };
}
