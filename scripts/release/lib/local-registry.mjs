import { mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { run, sha256Hex, sriFromHex } from "./util.mjs";
import { readTgz, readPackageJson } from "./tar.mjs";
import { ReleaseError, ERROR_CODES } from "./errors.mjs";

// This card's contract is HTTP-only loopback on 127.0.0.1 / ::1. localhost and
// https are intentionally excluded so a resolver/proxy cannot smuggle traffic
// to an external origin.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1"]);

const MINIMAL_ENV_KEYS = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SHELL",
  "TERM",
]);

const REQUEST_GUARD_PATH = fileURLToPath(new URL("./request-guard.cjs", import.meta.url));

function parseHttpUrl(raw, what) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ReleaseError(ERROR_CODES.URL, `${what} is not a valid URL: ${raw}`);
  }
  return url;
}

function originOf(url) {
  return `${url.protocol}//${url.host}`;
}

function assertLoopback(url, what, { origin } = {}) {
  if (url.protocol !== "http:") {
    throw new ReleaseError(ERROR_CODES.URL, `${what} must use http (not ${url.protocol})`);
  }
  if (url.username || url.password) {
    throw new ReleaseError(ERROR_CODES.URL, `${what} must not contain userinfo`);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new ReleaseError(ERROR_CODES.URL, `${what} must be 127.0.0.1 or ::1, got ${hostname}`);
  }
  if (origin && originOf(url) !== origin) {
    throw new ReleaseError(ERROR_CODES.URL, `${what} origin ${originOf(url)} does not match registry ${origin}`);
  }
}

/** Validate a registry URL: HTTP loopback, no path/query/fragment/userinfo. */
export function validateLoopbackRegistry(raw) {
  const url = parseHttpUrl(raw, "registry");
  assertLoopback(url, "registry");
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new ReleaseError(ERROR_CODES.URL, "registry URL must not contain an extra path");
  }
  if (url.search || url.hash) {
    throw new ReleaseError(ERROR_CODES.URL, "registry URL must not contain query or fragment");
  }
  return url.toString().replace(/\/$/, "");
}

/** Validate a URL (e.g. dist.tarball) is HTTP loopback, optionally same origin. */
export function assertLoopbackUrl(raw, what = "url", origin) {
  const url = parseHttpUrl(raw, what);
  assertLoopback(url, what, { origin });
  return url.toString();
}

export function registryOrigin(registry) {
  return originOf(new URL(validateLoopbackRegistry(registry)));
}

/** Build an isolated npmrc that carries only synthetic loopback auth. */
export function buildIsolatedNpmrc({ registry, authToken, auth, scope }) {
  const base = registry.replace(/\/$/, "");
  const host = new URL(registry).host;
  const lines = [
    `registry=${base}/`,
    `ignore-scripts=true`,
    `audit=false`,
    `fund=false`,
    `update-notifier=false`,
    `proxy=`,
    `https-proxy=`,
  ];
  if (scope) lines.push(`${scope}:registry=${base}/`);
  if (authToken) lines.push(`//${host}/:_authToken=${authToken}`);
  if (auth) lines.push(`//${host}/:_auth=${auth}`);
  return `${lines.join("\n")}\n`;
}

/** A minimal, proxy/credential-free child environment. */
export function minimalEnv({ preload = REQUEST_GUARD_PATH, allowedOrigin, auditPath } = {}) {
  const env = {};
  for (const key of MINIMAL_ENV_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  if (preload) {
    env.NODE_OPTIONS = `--require=${preload}`;
  }
  if (allowedOrigin) {
    env.NEXTY_RELEASE_ALLOWED_ORIGIN = allowedOrigin;
  }
  if (auditPath) {
    env.NEXTY_RELEASE_AUDIT_PATH = auditPath;
  }
  return env;
}

function writeIsolatedNpmrc(dir, filename, content) {
  const path = join(dir, filename);
  writeFileSync(path, content, { mode: 0o600 });
  return path;
}

/** Check that the effective npm CLI is major 11+. */
export function checkNpmVersion(npmPath = "npm") {
  const res = run(npmPath, ["--version"]);
  if (!res.ok) {
    throw new ReleaseError(ERROR_CODES.REGISTRY, `cannot read npm version: ${res.stderr || res.error?.message}`);
  }
  const raw = res.stdout.trim();
  const major = Number.parseInt(raw.split(".")[0], 10);
  if (!Number.isFinite(major) || major < 11) {
    throw new ReleaseError(ERROR_CODES.REGISTRY, `npm 11+ required, found ${raw}`);
  }
  return { raw, major };
}

/** Read the packed package.json `publishConfig`, if any, for target detection. */
export function detectPublishConfig(tgzPath) {
  const archive = readTgz(tgzPath);
  const { json } = readPackageJson(archive.files);
  return json.publishConfig ?? null;
}

function scopedPath(name) {
  return name.startsWith("@") ? name.replace("/", "%2F") : name;
}

export function isolatedNpmContext({ registry, scope, authToken, auth, tmpDir }) {
  const dir = tmpDir ?? mkdtempSync(join(tmpdir(), "release-npm-"));
  const userconfig = writeIsolatedNpmrc(dir, "npmrc-user", buildIsolatedNpmrc({ registry, authToken, auth, scope }));
  const globalconfig = writeIsolatedNpmrc(dir, "npmrc-global", "");
  const cache = join(dir, "cache");
  return { dir, userconfig, globalconfig, cache };
}

function npmArgs(registry, ctx, extra) {
  return [
    "--registry",
    `${registry.replace(/\/$/, "")}/`,
    "--userconfig",
    ctx.userconfig,
    "--globalconfig",
    ctx.globalconfig,
    "--cache",
    ctx.cache,
    ...extra,
  ];
}

/** Execute npm publish for a single tarball against the isolated loopback. */
export function publishOne({ tgzPath, registry, tag, scope, authToken, auth, npmPath = "npm", tmpDir, auditPath, runner = run }) {
  const ctx = isolatedNpmContext({ registry, scope, authToken, auth, tmpDir });
  const args = [
    "publish",
    tgzPath,
    ...npmArgs(registry, ctx, ["--tag", tag, "--ignore-scripts", "--loglevel", "warn"]),
  ];
  const res = runner(npmPath, args, { cwd: ctx.dir, env: minimalEnv({ allowedOrigin: registryOrigin(registry), auditPath }) });
  return { ok: res.ok, stdout: res.stdout, stderr: res.stderr, args, publishConfig: detectPublishConfig(tgzPath), ctx };
}

/** Add a dist-tag on the loopback registry (stable promotion step). */
export function distTagOne({ name, version, tag, registry, scope, authToken, auth, npmPath = "npm", tmpDir, auditPath, runner = run }) {
  const ctx = isolatedNpmContext({ registry, scope, authToken, auth, tmpDir });
  const args = [
    "dist-tag",
    "add",
    `${name}@${version}`,
    tag,
    ...npmArgs(registry, ctx, ["--loglevel", "warn"]),
  ];
  const res = runner(npmPath, args, { cwd: ctx.dir, env: minimalEnv({ allowedOrigin: registryOrigin(registry), auditPath }) });
  return { ok: res.ok, stdout: res.stdout, stderr: res.stderr, args, ctx };
}

async function fetchNoRedirect(url, fetchFn) {
  const res = await fetchFn(url, { redirect: "error" });
  if (!res.ok) {
    throw new ReleaseError(ERROR_CODES.REGISTRY, `GET ${url} failed with ${res.status}`);
  }
  return res;
}

/** Read registry metadata for one package/version from the loopback only. */
export async function readPackageMetadata({ name, version, registry, fetchFn = fetch }) {
  const base = registry.replace(/\/$/, "");
  const origin = registryOrigin(base);
  const url = `${base}/${scopedPath(name)}`;
  const res = await fetchNoRedirect(url, fetchFn);
  const body = await res.json();
  const meta = body?.versions?.[version];
  if (!meta) {
    throw new ReleaseError(ERROR_CODES.REGISTRY, `${name}@${version} not found in registry metadata`);
  }
  const tarballUrl = meta.dist?.tarball;
  if (!tarballUrl) {
    throw new ReleaseError(ERROR_CODES.REGISTRY, `${name}@${version} metadata has no dist.tarball`);
  }
  assertLoopbackUrl(tarballUrl, "dist.tarball", origin);
  return {
    name,
    version,
    tarballUrl,
    integrity: meta.dist?.integrity ?? null,
    shasum: meta.dist?.shasum ?? null,
    distTags: body?.["dist-tags"] ?? null,
  };
}

/** Query whether an exact version already exists on the loopback registry. */
export async function queryRemoteVersion({ name, version, registry, fetchFn = fetch }) {
  const base = registry.replace(/\/$/, "");
  const origin = registryOrigin(base);
  const url = `${base}/${scopedPath(name)}`;
  let res;
  try {
    res = await fetchFn(url, { redirect: "error" });
  } catch (err) {
    throw new ReleaseError(ERROR_CODES.REGISTRY, `cannot query ${url}: ${err.message}`);
  }
  if (res.status === 404) return { found: false, distTags: null };
  if (!res.ok) throw new ReleaseError(ERROR_CODES.REGISTRY, `GET ${url} failed with ${res.status}`);
  const body = await res.json();
  const meta = body?.versions?.[version];
  if (!meta) return { found: false, distTags: body?.["dist-tags"] ?? null };
  const tarballUrl = meta.dist?.tarball;
  assertLoopbackUrl(tarballUrl, "dist.tarball", origin);
  return {
    found: true,
    distTags: body?.["dist-tags"] ?? null,
    meta: { name, version, tarballUrl, integrity: meta.dist?.integrity ?? null, distTags: body?.["dist-tags"] ?? null },
  };
}

/**
 * Fail closed on unsupported/unexpected dist-tag state. `latest` is never an
 * explicit tag; if the registry auto-materializes a `latest` pointing elsewhere
 * (stock Verdaccio does this on first non-latest publish), we report it instead
 * of silently treating it as canonical.
 */
export function assertExpectedDistTag({ name, version, tag, distTags, baseline }) {
  if (tag === "latest") {
    throw new ReleaseError(ERROR_CODES.REGISTRY, "latest dist-tag is not supported by this tool");
  }
  const tags = distTags && typeof distTags === "object" ? distTags : {};
  const selected = tags[tag];
  if (selected === undefined || selected !== version) {
    throw new ReleaseError(
      ERROR_CODES.REGISTRY,
      `${name}@${version}: expected ${tag} dist-tag to equal ${version}, got ${selected === undefined ? "(missing)" : selected}`,
    );
  }
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline)) {
    throw new ReleaseError(
      ERROR_CODES.REGISTRY,
      `${name}@${version}: no tag baseline recorded; cannot verify latest has not advanced`,
    );
  }
  const prevLatest = baseline.latest; // undefined means "previously absent"
  if (tags.latest !== prevLatest) {
    throw new ReleaseError(
      ERROR_CODES.REGISTRY,
      `${name}@${version}: latest moved from ${prevLatest ?? "(absent)"} to ${tags.latest ?? "(absent)"} (unexpected advancement)`,
    );
  }
}

function verifyIntegrityDigest(buf, integrity) {
  if (typeof integrity !== "string" || integrity.length === 0) return false;
  const m = /^(sha1|sha256|sha384|sha512)-([A-Za-z0-9+/=]+)$/.exec(integrity);
  if (!m) return false;
  const actual = createHash(m[1]).update(buf).digest("base64");
  return actual === m[2];
}

/** Download and digest a tarball, confirming manifest sha256/sri and metadata integrity. */
export async function readAndVerifyTarball({ tarballUrl, sha256, sri, name, version, integrity, registry, fetchFn = fetch }) {
  const origin = registryOrigin(registry);
  assertLoopbackUrl(tarballUrl, "dist.tarball", origin);
  const res = await fetchNoRedirect(tarballUrl, fetchFn);
  const buf = Buffer.from(await res.arrayBuffer());

  const actualHex = sha256Hex(buf);
  if (actualHex !== sha256) {
    throw new ReleaseError(ERROR_CODES.REGISTRY, `${name}@${version} tarball sha256 mismatch: ${actualHex} != ${sha256}`);
  }
  const actualSri = sriFromHex(actualHex);
  if (actualSri !== sri) {
    throw new ReleaseError(ERROR_CODES.REGISTRY, `${name}@${version} tarball sri mismatch: ${actualSri} != ${sri}`);
  }
  if (!verifyIntegrityDigest(buf, integrity)) {
    throw new ReleaseError(
      ERROR_CODES.REGISTRY,
      `${name}@${version} metadata dist.integrity missing or mismatched: ${integrity ?? "(none)"}`,
    );
  }
  return { name, version, sha256: actualHex, sri: actualSri, size: buf.length };
}

/** Verify one manifest package exists on the loopback with matching digest. */
export async function verifyOneLocal({ entry, registry, tag = "candidate", baseline, fetchFn = fetch }) {
  const meta = await readPackageMetadata({ name: entry.name, version: entry.version, registry, fetchFn });
  const verified = await readAndVerifyTarball({
    tarballUrl: meta.tarballUrl,
    sha256: entry.sha256,
    sri: entry.sri,
    name: entry.name,
    version: entry.version,
    integrity: meta.integrity,
    registry,
    fetchFn,
  });
  assertExpectedDistTag({ name: entry.name, version: entry.version, tag, distTags: meta.distTags, baseline });
  return { name: entry.name, version: entry.version, integrity: verified.sri, size: verified.size };
}

/** Verify every manifest package on the loopback. */
export async function verifyLocal({ manifest, registry, tag = "candidate", baselines = {}, fetchFn = fetch }) {
  const receipts = [];
  for (const name of Object.keys(manifest.packages).sort()) {
    receipts.push(await verifyOneLocal({
      entry: manifest.packages[name],
      registry,
      tag,
      baseline: baselines[name] ?? {},
      fetchFn,
    }));
  }
  return receipts;
}
