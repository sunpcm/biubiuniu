import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";

import { ReleaseError, ERROR_CODES } from "./errors.mjs";

const BLOCK = 512;

const TYPE_FILE = "0";
const TYPE_HARDLINK = "1";
const TYPE_SYMLINK = "2";
const TYPE_DIR = "5";
const TYPE_LONGNAME = "L";
const TYPE_LONGLINK = "K";
const TYPE_PAX = "x";
const TYPE_GLOBAL = "g";

function ascii(block, off, len) {
  const end = off + len;
  let i = off;
  while (i < end && block[i] !== 0) i += 1;
  return block.subarray(off, i).toString("utf8");
}

function parseOctal(block, off, len) {
  const s = ascii(block, off, len).trim();
  if (s === "") return 0;
  return parseInt(s, 8);
}

function parseNumeric(block, off, len) {
  if (block[off] & 0x80) {
    // GNU base-256 encoding (only needed for very large files).
    let n = 0;
    for (let i = 0; i < len; i += 1) n = n * 256 + (block[off + i] & 0xff);
    return n;
  }
  return parseOctal(block, off, len);
}

function parseHeader(block) {
  return {
    name: ascii(block, 0, 100),
    mode: parseOctal(block, 100, 8),
    uid: parseOctal(block, 108, 8),
    gid: parseOctal(block, 116, 8),
    size: parseNumeric(block, 124, 12),
    mtime: parseOctal(block, 136, 12),
    typeflag: block[156] === 0 ? TYPE_FILE : String.fromCharCode(block[156]),
    linkname: ascii(block, 157, 100),
    magic: ascii(block, 257, 6),
    prefix: ascii(block, 345, 155),
  };
}

function parsePax(content) {
  const text = content.toString("utf8");
  const out = {};
  let i = 0;
  while (i < text.length) {
    const space = text.indexOf(" ", i);
    if (space < 0) break;
    const lenStr = text.slice(i, space);
    if (!/^\d+$/.test(lenStr)) break;
    const len = parseInt(lenStr, 10);
    if (len <= 0 || i + len > text.length) break;
    const kv = text.slice(space + 1, i + len);
    const eq = kv.indexOf("=");
    if (eq > 0) out[kv.slice(0, eq)] = kv.slice(eq + 1).replace(/\n$/, "");
    i += len;
  }
  return out;
}

/**
 * Read a `.tgz` archive into `{ entries, files }`. `entries` preserves order
 * and exposes type/symlink/hardlink metadata; `files` maps each regular-file
 * path to its decoded content Buffer. Handles GNU long-name/long-link and pax
 * extended headers so npm/pnpm tarballs are read faithfully.
 */
export function readTgz(tgzPath) {
  const raw = readFileSync(tgzPath);
  let buf;
  try {
    buf = gunzipSync(raw);
  } catch (err) {
    throw new ReleaseError(ERROR_CODES.TAR, `cannot gunzip ${tgzPath}: ${err.message}`);
  }

  const entries = [];
  const files = new Map();
  let offset = 0;
  let pendingName = null;
  let pendingLink = null;
  let pax = null;

  while (offset + BLOCK <= buf.length) {
    const block = buf.subarray(offset, offset + BLOCK);
    if (block.every((b) => b === 0)) break;

    const header = parseHeader(block);
    offset += BLOCK;
    const size = header.size;
    const content = size > 0 ? buf.subarray(offset, offset + size) : Buffer.alloc(0);
    offset += size + ((BLOCK - (size % BLOCK)) % BLOCK);

    if (header.typeflag === TYPE_LONGNAME) {
      pendingName = content.toString("utf8").replace(/\0+$/, "");
      continue;
    }
    if (header.typeflag === TYPE_LONGLINK) {
      pendingLink = content.toString("utf8").replace(/\0+$/, "");
      continue;
    }
    if (header.typeflag === TYPE_PAX) {
      pax = parsePax(content);
      continue;
    }
    if (header.typeflag === TYPE_GLOBAL) continue;

    let name = pendingName ?? header.name;
    pendingName = null;
    let linkname = pendingLink ?? header.linkname;
    pendingLink = null;
    let type = header.typeflag;

    if (pax) {
      if (pax.path !== undefined) name = pax.path;
      if (pax.linkpath !== undefined) linkname = pax.linkpath;
      if (pax.type !== undefined) type = pax.type;
      pax = null;
    }
    if (header.prefix) name = `${header.prefix}/${name}`;

    const entry = {
      path: name,
      type,
      size,
      mode: header.mode,
      mtime: header.mtime,
      linkname,
      content: null,
    };
    if (type === TYPE_FILE) entry.content = content;
    entries.push(entry);
    if (entry.content !== null) files.set(name, entry.content);
  }

  return { entries, files };
}

function encodeOctal(value, len) {
  const s = value.toString(8);
  if (s.length > len - 1) throw new ReleaseError(ERROR_CODES.TAR, `tar field overflow: ${value}`);
  return `${s.padStart(len - 1, "0")}\0`;
}

function writeString(block, value, off, len) {
  const b = Buffer.from(value, "utf8");
  b.copy(block, off, 0, Math.min(b.length, len));
}

function splitName(path) {
  if (Buffer.byteLength(path, "utf8") <= 100) return { prefix: "", name: path };
  const idx = path.lastIndexOf("/");
  if (idx <= 0 || idx > 155) {
    throw new ReleaseError(ERROR_CODES.TAR, `tar path too long for ustar: ${path}`);
  }
  const prefix = path.slice(0, idx);
  const name = path.slice(idx + 1);
  if (Buffer.byteLength(name, "utf8") > 100 || Buffer.byteLength(prefix, "utf8") > 155) {
    throw new ReleaseError(ERROR_CODES.TAR, `tar path component too long: ${path}`);
  }
  return { prefix, name };
}

function writeHeader(entry) {
  const block = Buffer.alloc(BLOCK);
  const { prefix, name } = splitName(entry.path);
  const type = entry.type ?? (entry.content !== undefined && entry.content !== null ? TYPE_FILE : TYPE_DIR);
  const size = entry.content ? entry.content.length : 0;
  const mode = entry.mode ?? (type === TYPE_DIR ? 0o755 : 0o644);
  const mtime = entry.mtime ?? 0;

  writeString(block, name, 0, 100);
  writeString(block, encodeOctal(mode, 8), 100, 8);
  writeString(block, encodeOctal(entry.uid ?? 0, 8), 108, 8);
  writeString(block, encodeOctal(entry.gid ?? 0, 8), 116, 8);
  writeString(block, encodeOctal(size, 12), 124, 12);
  writeString(block, encodeOctal(mtime, 12), 136, 12);
  block.fill(0x20, 148, 156);
  block[156] = type === TYPE_FILE ? 0 : type.charCodeAt(0);
  writeString(block, entry.linkname ?? "", 157, 100);
  writeString(block, "ustar\0", 257, 6);
  writeString(block, "00", 263, 2);
  writeString(block, "", 265, 32);
  writeString(block, "", 297, 32);
  writeString(block, "", 329, 8);
  writeString(block, "", 337, 8);
  writeString(block, prefix, 345, 155);

  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += block[i];
  const chk = `${sum.toString(8).padStart(6, "0")}\0 `;
  writeString(block, chk, 148, 8);
  return block;
}

/**
 * Write entries back to a deterministic ustar+gzip archive. Entries must be
 * regular files or directories; the caller is responsible for ordering.
 */
export function createTgz(entries, outPath) {
  const chunks = [];
  for (const entry of entries) {
    chunks.push(writeHeader(entry));
    if (entry.content !== null && entry.content !== undefined && entry.content.length > 0) {
      chunks.push(entry.content);
      const pad = (BLOCK - (entry.content.length % BLOCK)) % BLOCK;
      if (pad > 0) chunks.push(Buffer.alloc(pad));
    }
  }
  chunks.push(Buffer.alloc(BLOCK * 2));
  writeFileSync(outPath, gzipSync(Buffer.concat(chunks)));
}

/** Normalize the npm `package/` prefix out of a tar entry path. */
export function stripPackagePrefix(path) {
  return path.startsWith("package/") ? path.slice("package/".length) : path;
}

/** Read the package.json Buffer from a tgz file map, accepting either prefix. */
export function readPackageJson(files) {
  const content = files.get("package/package.json") ?? files.get("package.json");
  if (!content) throw new ReleaseError(ERROR_CODES.TAR, "archive has no package.json");
  let parsed;
  try {
    parsed = JSON.parse(content.toString("utf8"));
  } catch (err) {
    throw new ReleaseError(ERROR_CODES.TAR, `invalid package.json in archive: ${err.message}`);
  }
  return { content, json: parsed };
}

/** Return a normalized (no `package/` prefix) map of relative path -> content. */
export function normalizedFileMap(files) {
  const out = new Map();
  for (const [path, content] of files.entries()) out.set(stripPackagePrefix(path), content);
  return out;
}
