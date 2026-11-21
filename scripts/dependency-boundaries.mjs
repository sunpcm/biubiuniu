/**
 * Fixed dependency-boundary check for the workspace package graph.
 *
 * Enforces the P3 package rules without running pnpm or any build:
 * - no cycles among workspace packages;
 * - every bare import (third-party or workspace) is declared, with scoped and
 *   subpath specifiers normalized to their real package root;
 * - Node builtins (`fs`, `path`, `node:fs`, …) are never undeclared;
 * - workspace subpaths must be declared in that package's `exports`;
 * - runtime (value) imports must live in dependencies/peer/optional, not only
 *   devDependencies;
 * - no package imports the app (`@/`) or escapes its own directory by a
 *   relative path;
 * - core packages (contracts/utils/auth/commerce) must not leak Next/PG/SDKs
 *   nor read product `process.env` from their *root entry closure* (following
 *   real JS/d.ts re-export edges, not filename heuristics); provider/client
 *   subpath entries may use their legal optional deps only if the root does not
 *   re-export them back;
 * - UI must not import server-only/Node/database modules;
 * - every package export target (types + import/default) must resolve to an
 *   existing artifact, including wildcard expansion and paired JS/types.
 *
 * `analyzeWorkspace` and `checkArtifacts` are pure and unit-testable with a
 * synthetic file tree; `loadWorkspace` builds a real model after the dist build.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXTS = new Set([".ts", ".tsx", ".mjs", ".js"]);

const NODE_BUILTINS = new Set([
  "assert", "assert/strict", "async_hooks", "buffer", "child_process",
  "cluster", "console", "constants", "crypto", "dgram", "diagnostics_channel",
  "dns", "dns/promises", "domain", "events", "fs", "fs/promises", "http",
  "http2", "https", "inspector", "module", "net", "os", "path", "path/posix",
  "path/win32", "perf_hooks", "process", "punycode", "querystring", "readline",
  "readline/promises", "repl", "stream", "stream/consumers", "stream/promises",
  "stream/web", "string_decoder", "sys", "timers", "timers/promises", "tls",
  "trace_events", "tty", "url", "util", "util/types", "v8", "vm", "wasi",
  "worker_threads", "zlib",
]);

/**
 * Per-package "core" rules. A core package's root entry closure must not leak
 * Next/PG/provider SDKs. `forbidden` matches the full bare specifier, so
 * `better-auth` core is allowed for auth while `better-auth/next-js` is not.
 * Reachability (not a directory name) decides whether a provider/client file is
 * part of the root closure.
 */
const CORE_RULES = {
  "@sunpcm/niu-contracts": {
    forbidden: /^(next|react|react-dom|drizzle-orm|postgres|stripe|creem|paypal|better-auth)(\/|$)/,
  },
  "@sunpcm/niu-utils": {
    forbidden: /^(next|react|react-dom|drizzle-orm|postgres|stripe|creem|paypal|better-auth)(\/|$)/,
  },
  "@sunpcm/niu-auth": {
    forbidden: /^(next|react|react-dom|drizzle-orm|postgres|stripe|creem|paypal)(\/|$)|^better-auth\/next-js/,
  },
  "@sunpcm/niu-commerce": {
    forbidden: /^(next|react|react-dom|drizzle-orm|postgres|stripe|creem|paypal)(\/|$)/,
  },
};

const UI_PACKAGE = "@sunpcm/niu-ui";
const UI_FORBIDDEN = /^(server-only|next|drizzle-orm|postgres)(\/|$)/;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isNodeBuiltin(spec) {
  if (spec.startsWith("node:")) return true;
  const root = spec.split("/")[0];
  return NODE_BUILTINS.has(root) || NODE_BUILTINS.has(spec);
}

export function normalizeBareSpecifier(spec) {
  if (!spec || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("#")) return null;
  if (spec.startsWith("@/")) return null;
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    if (parts.length < 2) return null;
    return { root: `${parts[0]}/${parts[1]}`, subpath: parts.slice(2).join("/") || null };
  }
  const parts = spec.split("/");
  return { root: parts[0], subpath: parts.slice(1).join("/") || null };
}

function posixDirname(p) {
  return p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".";
}
function posixJoin(a, b) {
  if (!a || a === ".") return b;
  return `${a.replace(/\/+$/, "")}/${b.replace(/^\/+/, "")}`;
}
function posixNormalize(p) {
  const isAbs = p.startsWith("/");
  const parts = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length && parts[parts.length - 1] !== "..") parts.pop();
      else parts.push("..");
    } else {
      parts.push(seg);
    }
  }
  let out = parts.join("/");
  if (isAbs) out = `/${out}`;
  return out || ".";
}

function stripDotSlash(p) {
  if (!p) return p;
  return p.startsWith("./") ? p.slice(2) : p;
}

/**
 * Parse an ESM/TS module source into its bare imports, relative import/re-export
 * targets, and whether it reads `process.env` directly. Covers `import`,
 * `import type`, `export … from`, `export * from`, dynamic `import()`, and
 * `require()`.
 */
export function parseModule(source) {
  const bare = [];
  const relative = [];
  const env = /\bprocess\s*\.\s*env\b/.test(source);

  const valueSpecs = new Set();
  const typeSpecs = new Set();

  const valueRe =
    /\bimport\b(?!\s+type\b)[^;]*?\bfrom\s*["']([^"']+)["']|\bexport\b(?!\s+type\b)[^;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;
  let m;
  while ((m = valueRe.exec(source)) !== null) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
    if (spec) valueSpecs.add(spec);
  }

  const typeRe = /\b(?:import|export)\s+type\b[^;]*?\bfrom\s*["']([^"']+)["']/g;
  while ((m = typeRe.exec(source)) !== null) typeSpecs.add(m[1]);

  // Inline type-only named imports/re-exports: `import { type A, type B } from "spec"`.
  // The value regex above captures these as value; correct them back to type when every
  // named clause is a `type` specifier (so `import { type Root } from "hast"` is a type import).
  const inlineTypeRe =
    /\b(?:import|export)\s*\{([^{}]*)\}\s*from\s*["']([^"']+)["']/g;
  while ((m = inlineTypeRe.exec(source)) !== null) {
    const clause = m[1];
    const spec = m[2];
    const parts = clause.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length && parts.every((p) => /^type\b/.test(p))) {
      valueSpecs.delete(spec);
      typeSpecs.add(spec);
    }
  }

  const seen = new Set();
  const collect = (spec, type) => {
    if (!spec || seen.has(spec)) return;
    seen.add(spec);
    if (spec.startsWith(".")) {
      relative.push(spec);
    } else if (!spec.startsWith("#") && !spec.startsWith("node:")) {
      bare.push({ spec, type });
    }
  };

  for (const spec of valueSpecs) collect(spec, "value");
  for (const spec of typeSpecs) collect(spec, "type");

  return { bare, relative, env };
}

/**
 * Resolve a raw relative specifier to a normalized package-relative key, trying
 * common extensions. Returns a `../`-prefixed key when the target escapes the
 * package directory (so reverse-import checks can see it).
 */
export function resolveRelativeSpecifier(fromFile, spec, files) {
  const dir = posixDirname(fromFile);
  const base = posixNormalize(posixJoin(dir, spec));
  for (const ext of ["", ".js", ".ts", ".tsx", ".mjs", ".d.ts", ".jsx"]) {
    const c = `${base}${ext}`;
    if (files.has(c)) return c;
  }
  for (const idx of ["index.js", "index.ts", "index.d.ts", "index.mjs", "index.tsx"]) {
    const c = posixJoin(base, idx);
    if (files.has(c)) return c;
  }
  return base;
}

function computeClosure(entryKeys, files) {
  const closure = new Set();
  const stack = entryKeys.filter((k) => files.has(k));
  while (stack.length) {
    const key = stack.pop();
    if (closure.has(key)) continue;
    closure.add(key);
    const node = files.get(key);
    for (const rel of node?.relative ?? []) {
      if (files.has(rel) && !closure.has(rel)) stack.push(rel);
    }
  }
  return closure;
}

function exportTargets(value) {
  if (typeof value === "string") return { types: null, js: value };
  return {
    types: value?.types ?? null,
    js: value?.import ?? value?.default ?? value?.require ?? null,
  };
}

function exportJsTarget(value) {
  if (typeof value === "string") return value;
  return value?.import ?? value?.default ?? value?.require ?? null;
}
function exportTypesTarget(value) {
  if (typeof value === "string") return null;
  return value?.types ?? null;
}

function detectCycles(adjacency) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map([...adjacency.keys()].map((n) => [n, WHITE]));
  const cycles = [];
  const visit = (node, stack) => {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      if (color.get(next) === WHITE) visit(next, stack);
      else if (color.get(next) === GRAY) cycles.push([...stack.slice(stack.indexOf(next)), next].join(" -> "));
    }
    stack.pop();
    color.set(node, BLACK);
  };
  for (const node of adjacency.keys()) if (color.get(node) === WHITE) visit(node, []);
  return cycles;
}

function exportsSubpath(exportsObj, subpath) {
  if (!exportsObj || typeof exportsObj !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(exportsObj, `./${subpath}`)) return true;
  return Object.keys(exportsObj).some((k) => k.includes("*") && subpath.startsWith(k.split("*")[0].replace(/^\.\//, "")));
}

/**
 * Map a bare type-only import to its DefinitelyTyped package when the runtime
 * package ships no types: `hast` -> `@types/hast`, `@scope/pkg` -> `@types/scope__pkg`.
 */
function typesPackage(root) {
  if (root.startsWith("@")) {
    const parts = root.split("/");
    if (parts.length >= 2) return `@types/${parts[0].slice(1)}__${parts[1]}`;
  }
  return `@types/${root}`;
}

/**
 * A build/migration/config file runs at build time, not as production runtime, so
 * its devDependency value imports are not "runtime hidden behind devDependencies".
 */
function isBuildConfigFile(file) {
  const base = file.split("/").pop() ?? file;
  return /\.config\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/.test(base);
}

/**
 * Resolve an export target to the actual file key present in the in-memory model.
 * Real builds expose `dist/*`; synthetic source-only fixtures may only provide
 * `src/*`, in which case `dist/foo.js` / `dist/foo.d.ts` falls back to `src/foo.ts`.
 */
function resolveEntryFile(pkg, target) {
  if (!target) return null;
  const key = stripDotSlash(target);
  if (pkg.files.has(key)) return key;
  if (!key.startsWith("dist/")) return key;
  const rest = key.slice("dist/".length);
  const base = rest.replace(/\.(?:d\.ts|js|mjs)$/, "");
  for (const src of [`src/${base}.ts`, `src/${base}.tsx`]) {
    if (pkg.files.has(src)) return src;
  }
  return key;
}

/**
 * Effective published files for a package: the closure reachable from its public
 * `exports` entry graph (JS + types, wildcards expanded). Archived source that is
 * not compiled to dist and not re-exported from a public entry is excluded.
 */
function packageEffectiveFiles(pkg) {
  if (!pkg.exports || typeof pkg.exports !== "object") return null;
  const entryKeys = new Set();
  for (const [key, value] of Object.entries(pkg.exports)) {
    if (key === "./package.json") continue;
    if (key.includes("*")) {
      const pattern = stripDotSlash(exportJsTarget(value) ?? "");
      if (pattern) for (const f of listMatchingFiles(pkg, pattern)) entryKeys.add(f);
    } else {
      for (const t of [exportJsTarget(value), exportTypesTarget(value)]) {
        const resolved = resolveEntryFile(pkg, t);
        if (resolved) entryKeys.add(resolved);
      }
    }
  }
  return computeClosure([...entryKeys], pkg.files);
}

/**
 * Analyze an in-memory workspace model. Each entry:
 *   { name, dir, kind, dependencies, devDependencies, peerDependencies,
 *     optionalDependencies, exports, files: Map<relPath, {bare:[{spec,type}], relative:[relPath], env:bool}> }
 */
export function analyzeWorkspace(packages) {
  const names = new Set(packages.keys());
  const entries = [...packages.entries()];
  const adjacency = new Map();
  for (const [name, pkg] of entries) {
    const declared = new Set([
      ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies,
    ]);
    adjacency.set(name, new Set([...declared].filter((d) => names.has(d) && d !== name)));
  }

  const cycles = detectCycles(adjacency);
  const violations = [];

  for (const [name, pkg] of entries) {
    const isPackage = pkg.kind !== "app";
    const runtime = new Set([...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies]);
    const allDeclared = new Set([...runtime, ...pkg.devDependencies]);

    // Packages are classified only over their published entry closure; archived
    // source (not compiled to dist and not re-exported) is not a runtime dependency.
    const effectiveFiles = isPackage ? packageEffectiveFiles(pkg) : null;

    const rule = CORE_RULES[name];
    let rootClosure = null;
    if (rule) {
      const rootJs = resolveEntryFile(pkg, exportJsTarget(pkg.exports?.["."]));
      const rootTypes = resolveEntryFile(pkg, exportTypesTarget(pkg.exports?.["."]));
      rootClosure = computeClosure([rootJs, rootTypes].filter(Boolean), pkg.files);
    }

    for (const [file, node] of pkg.files) {
      if (isPackage && effectiveFiles && !effectiveFiles.has(file)) continue;

      for (const { spec, type } of node.bare) {
        if (isNodeBuiltin(spec)) continue;

        if (spec.startsWith("@/")) {
          if (isPackage) violations.push({ package: name, kind: "reverse", spec, file, reason: "package imports the app via @/ alias" });
          continue;
        }

        const normalized = normalizeBareSpecifier(spec);
        if (!normalized) continue;
        const { root, subpath } = normalized;

        const declared =
          allDeclared.has(root) ||
          (type === "type" && !names.has(root) && allDeclared.has(typesPackage(root)));
        if (!declared) {
          violations.push({ package: name, kind: "undeclared", spec, root, subpath, file, reason: "bare import is not declared in any dependency" });
          continue;
        }
        if (names.has(root) && subpath && !exportsSubpath(packages.get(root).exports, subpath)) {
          violations.push({ package: name, kind: "undeclared-subpath", spec, root, subpath, file, reason: "workspace subpath is not declared in exports" });
        }
        if (type === "value" && !runtime.has(root) && pkg.devDependencies.has(root) && !isBuildConfigFile(file)) {
          violations.push({ package: name, kind: "runtime-dev-dep", spec, root, file, reason: "runtime import is only declared in devDependencies" });
        }
      }

      if (isPackage) {
        for (const rel of node.relative) {
          if (rel.startsWith("../")) {
            violations.push({ package: name, kind: "reverse", spec: rel, file, reason: "relative import escapes the package directory" });
          }
        }
      }

      if (name === UI_PACKAGE) {
        for (const { spec } of node.bare) {
          if (UI_FORBIDDEN.test(spec) || isNodeBuiltin(spec)) {
            violations.push({ package: name, kind: "ui-server", spec, file, reason: "UI imports a server/Node/database module" });
          }
        }
      }

      if (rule && rootClosure && rootClosure.has(file)) {
        for (const { spec } of node.bare) {
          if (rule.forbidden.test(spec)) {
            violations.push({ package: name, kind: "core-leak", spec, file, reason: "core root closure leaks a forbidden module" });
          }
        }
        if (node.env) {
          violations.push({ package: name, kind: "core-env", file, reason: "core root closure reads process.env directly" });
        }
      }
    }
  }

  return { cycles, violations };
}

function fileExists(pkg, rel) {
  const key = stripDotSlash(rel);
  if (pkg.files && pkg.files.has(key)) return true;
  return existsSync(join(pkg.dir, key));
}

function listMatchingFiles(pkg, pattern) {
  const regex = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "([^/]+)")}$`);
  const results = [];
  for (const f of pkg.files?.keys() ?? []) if (regex.test(f)) results.push(f);
  const dir = join(pkg.dir, posixDirname(pattern));
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir)) {
      const rel = relative(pkg.dir, join(dir, entry)).replace(/\\/g, "/");
      if (regex.test(rel) && !results.includes(rel)) results.push(rel);
    }
  }
  return results;
}

function starValue(pattern, file) {
  const i = pattern.indexOf("*");
  if (i === -1) return null;
  const prefix = pattern.slice(0, i);
  const suffix = pattern.slice(i + 1);
  if (!file.startsWith(prefix) || !file.endsWith(suffix)) return null;
  return file.slice(prefix.length, file.length - suffix.length);
}

function checkExport(pkg, name, key, value, violations) {
  if (typeof value === "string") {
    if (!fileExists(pkg, value)) {
      violations.push({ package: name, kind: "missing-dist", export: key, file: value, reason: "export target does not exist" });
    }
    return;
  }
  const { types, js } = exportTargets(value);
  if (!types && !js) {
    violations.push({ package: name, kind: "missing-dist", export: key, file: null, reason: "export has no types/import/default/require target" });
    return;
  }
  if (types && !fileExists(pkg, types)) {
    violations.push({ package: name, kind: "missing-dist", export: key, file: types, reason: "declared types target does not exist" });
  }
  if (js && !fileExists(pkg, js)) {
    violations.push({ package: name, kind: "missing-dist", export: key, file: js, reason: "declared import/default/require target does not exist" });
  }
}

function checkWildcard(pkg, name, key, value, violations) {
  const { types, js } = exportTargets(value);
  const jsPattern = stripDotSlash(js ?? "");
  const typesPattern = types ? stripDotSlash(types) : null;
  const matches = jsPattern ? listMatchingFiles(pkg, jsPattern) : [];
  if (matches.length === 0) {
    violations.push({ package: name, kind: "missing-dist", export: key, file: jsPattern || null, reason: "wildcard matches no artifacts" });
    return;
  }
  for (const jsFile of matches) {
    const star = starValue(jsPattern, jsFile);
    if (star === null || star === "") {
      violations.push({ package: name, kind: "missing-dist", export: key, file: jsFile, reason: "wildcard match has an empty component" });
      continue;
    }
    if (typesPattern) {
      const typesFile = typesPattern.replace("*", star);
      if (!fileExists(pkg, typesFile)) {
        violations.push({ package: name, kind: "missing-dist", export: key, file: typesFile, reason: "wildcard types artifact missing (JS/types must be paired)" });
      }
    }
  }
}

export function checkArtifacts(packages) {
  const violations = [];
  for (const [name, pkg] of packages) {
    if (pkg.kind === "app") continue;
    if (!pkg.exports || typeof pkg.exports !== "object") continue;
    for (const [key, value] of Object.entries(pkg.exports)) {
      if (key === "./package.json") continue;
      if (key.includes("*")) checkWildcard(pkg, name, key, value, violations);
      else checkExport(pkg, name, key, value, violations);
    }
  }
  return violations;
}

function listPackageDirs(rootDir) {
  const dirs = [];
  for (const base of ["packages", "apps"]) {
    const baseDir = join(rootDir, base);
    if (!existsSync(baseDir)) continue;
    const kind = base === "apps" ? "app" : "package";
    for (const entry of readdirSync(baseDir)) {
      const p = join(baseDir, entry);
      if (!statSync(p).isDirectory()) continue;
      if (base === "packages" && entry === "configs") {
        for (const cfg of readdirSync(p)) {
          const cp = join(p, cfg);
          if (existsSync(join(cp, "package.json"))) dirs.push({ dir: cp, kind });
        }
      } else if (existsSync(join(p, "package.json"))) {
        dirs.push({ dir: p, kind });
      }
    }
  }
  return dirs;
}

function scanFiles(rootDir) {
  const files = new Map();
  for (const base of ["dist", "src"]) {
    const baseDir = join(rootDir, base);
    if (!existsSync(baseDir)) continue;
    const stack = [baseDir];
    while (stack.length) {
      const current = stack.pop();
      const st = statSync(current);
      if (st.isFile()) {
        const rel = relative(rootDir, current).replace(/\\/g, "/");
        if (SOURCE_EXTS.has(extname(current)) || current.endsWith(".d.ts")) {
          const parsed = parseModule(readFileSync(current, "utf8"));
          files.set(rel, { bare: parsed.bare, relativeRaw: parsed.relative, env: parsed.env, relative: [] });
        }
        continue;
      }
      for (const entry of readdirSync(current)) stack.push(join(current, entry));
    }
  }
  for (const [file, node] of files) {
    node.relative = (node.relativeRaw ?? []).map((spec) => resolveRelativeSpecifier(file, spec, files));
    delete node.relativeRaw;
  }
  return files;
}

export function loadWorkspace(rootDir) {
  const packages = new Map();
  for (const { dir, kind } of listPackageDirs(rootDir)) {
    const manifest = readJson(join(dir, "package.json"));
    packages.set(manifest.name, {
      name: manifest.name,
      dir,
      kind,
      dependencies: new Set(Object.keys(manifest.dependencies ?? {})),
      devDependencies: new Set(Object.keys(manifest.devDependencies ?? {})),
      peerDependencies: new Set(Object.keys(manifest.peerDependencies ?? {})),
      optionalDependencies: new Set(Object.keys(manifest.optionalDependencies ?? {})),
      exports: manifest.exports ?? null,
      files: scanFiles(dir),
    });
  }
  return packages;
}

export function main(rootDir = process.cwd(), { includeArtifacts = true } = {}) {
  const packages = loadWorkspace(rootDir);
  const report = analyzeWorkspace(packages);
  if (includeArtifacts) report.missingDist = checkArtifacts(packages);
  const clean =
    report.cycles.length === 0 &&
    report.violations.length === 0 &&
    (!report.missingDist || report.missingDist.length === 0);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return clean ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv[2] ?? process.cwd());
}
