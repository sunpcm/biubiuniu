import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

export function sha256Hex(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  return createHash("sha256").update(buf).digest("hex");
}

export function sha256HexStreamed(chunks) {
  const h = createHash("sha256");
  for (const chunk of chunks) h.update(chunk);
  return h.digest("hex");
}

/** Subresource-integrity string for a SHA-256 hex digest. */
export function sriFromHex(hex) {
  return `sha256-${Buffer.from(hex, "hex").toString("base64")}`;
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key]);
    return out;
  }
  return value;
}

/** Deterministic JSON serialization with recursively sorted keys. */
export function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

/** SHA-256 of the deterministic JSON form of a value. */
export function hashJson(value) {
  return sha256Hex(stableJson(value));
}

/** Normalize text content for payload comparison: CRLF -> LF, no BOM. */
export function normalizeText(content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  let text = buf.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r\n/g, "\n");
}

/** Structural equality that ignores object key order but preserves array order. */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i] !== kb[i]) return false;
    if (!deepEqual(a[ka[i]], b[kb[i]])) return false;
  }
  return true;
}

/** Minimal spawn wrapper returning strings, never throwing on non-zero exit. */
export function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  return {
    ok: res.status === 0 && res.error === undefined,
    status: res.status ?? null,
    signal: res.signal ?? null,
    error: res.error ?? null,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

/** Write a JSON file atomically via a same-directory temp file + rename. */
export function atomicWriteJson(fs, filePath, value) {
  const { writeFileSync, renameSync } = fs;
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${stableJson(value)}\n`);
  renameSync(tmp, filePath);
}
