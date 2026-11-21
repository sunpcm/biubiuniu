"use strict";

// Auditable preload that constrains every HTTP(S)/fetch request a release child
// process makes to the single loopback origin passed by the parent. It never
// trusts ambient arbitrary NODE_OPTIONS: the parent controls the only `--require`
// entry and sets NEXTY_RELEASE_ALLOWED_ORIGIN itself. When
// NEXTY_RELEASE_AUDIT_PATH is set, each resolved final target is appended there
// (origin + pathname only, never auth/credentials) for the parent to verify.
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const { appendFileSync } = require("node:fs");

const ALLOWED_ORIGIN = (process.env.NEXTY_RELEASE_ALLOWED_ORIGIN || "").replace(/\/$/, "");
const AUDIT_PATH = process.env.NEXTY_RELEASE_AUDIT_PATH || "";
const ALLOWED_TARGET = parseAllowedTarget(ALLOWED_ORIGIN);

function originOf(value) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isAllowedOrigin(origin, allowed) {
  if (!allowed) return false;
  return origin === allowed;
}

function assertAllowedOrigin(input, allowed = ALLOWED_ORIGIN) {
  if (!allowed) {
    throw new Error("NEXTY_RELEASE request guard: no allowed origin configured");
  }
  const origin = originOf(input);
  if (origin === null || !isAllowedOrigin(origin, allowed)) {
    throw new Error(`NEXTY_RELEASE request guard: origin ${origin ?? "(unparseable)"} is not allowed (expected ${allowed})`);
  }
}

function bracketHost(host) {
  const h = String(host).trim().replace(/^\[|\]$/g, "");
  // Only an IPv6 literal needs brackets; a "host:port" string must not be
  // treated as IPv6 (Node keeps `host` literal and never splits its port).
  return h.includes(":") && !h.includes(".") ? `[${h}]` : h;
}

// Resolve the final effective origin for an http/https request, applying Node's
// options overrides (hostname/host/port/protocol) on top of a URL string/object,
// including the single-argument options overload used by minipass-fetch
// (send(options) -> http.request(options)).
function resolveOrigin(input, options, defaultProtocol) {
  let hostname = null;
  let host = null;
  let port = null;
  let protocol = null;

  if (input instanceof URL) {
    hostname = input.hostname;
    port = input.port;
    protocol = input.protocol;
  } else if (typeof input === "string") {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
      try {
        const u = new URL(input);
        hostname = u.hostname;
        port = u.port;
        protocol = u.protocol;
      } catch {
        return { error: `unparseable URL: ${input}` };
      }
    }
  } else if (input && typeof input === "object") {
    // The first object is itself the options in http.request(options[, cb]).
    if (typeof input.href === "string") {
      try {
        const u = new URL(input.href);
        hostname = u.hostname;
        port = u.port;
        protocol = u.protocol;
      } catch {
        return { error: `unparseable href: ${input.href}` };
      }
    }
    if (input.protocol !== undefined) protocol = input.protocol;
    if (input.hostname !== undefined) hostname = input.hostname;
    if (input.host !== undefined) host = input.host;
    if (input.port !== undefined) port = String(input.port);
  } else {
    return { error: "unsupported request input" };
  }

  // The second argument is options only when it is a plain object; a function
  // here is the callback of the single-argument overload and must be ignored.
  if (options && typeof options === "object" && !Array.isArray(options)) {
    if (options.protocol !== undefined) protocol = options.protocol;
    if (options.hostname !== undefined) hostname = options.hostname;
    if (options.host !== undefined) host = options.host;
    if (options.port !== undefined) port = String(options.port);
  }

  // Node contract: hostname takes precedence over host, and host is used
  // literally (port comes only from options.port or the default).
  const effectiveHost = hostname || host;
  if (!effectiveHost) return { error: "request has no resolvable host" };
  const proto = protocol || defaultProtocol || "http:";
  const p = port ? Number(port) : proto === "https:" ? 443 : 80;
  if (!Number.isInteger(p) || p < 1 || p > 65535) return { error: `invalid port ${port}` };

  let origin;
  try {
    origin = new URL(`${proto}//${bracketHost(effectiveHost)}:${p}`).origin;
  } catch {
    return { error: `cannot build origin from ${effectiveHost}:${p}` };
  }
  return { origin };
}

function fetchOrigin(input) {
  let urlStr = null;
  if (typeof input === "string") urlStr = input;
  else if (input instanceof URL) urlStr = input.href;
  else if (input && typeof input === "object" && typeof input.url === "string") urlStr = input.url;
  else return { error: "unsupported fetch input" };
  const origin = originOf(urlStr);
  if (!origin) return { error: `unparseable fetch URL: ${urlStr}` };
  return { origin };
}

function recordTarget(origin, path) {
  if (!AUDIT_PATH) return;
  appendAudit(AUDIT_PATH, origin, path);
}

function appendAudit(auditPath, origin, path) {
  if (!auditPath) return;
  try {
    appendFileSync(auditPath, `${JSON.stringify({ origin, path })}\n`, { mode: 0o600 });
  } catch {
    // Audit is best-effort and never blocks the request.
  }
}

function normalizeHost(host) {
  return String(host).trim().replace(/^\[|\]$/g, "");
}

/** Parse the allowed origin into an exact TCP { host, port } target. */
function parseAllowedTarget(origin) {
  if (!origin) return null;
  try {
    const u = new URL(origin);
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    return { host: normalizeHost(u.hostname), port };
  } catch {
    return null;
  }
}

/**
 * Extract the final TCP target from a net.Socket#connect argument list, honoring
 * Node's native overloads. Node internally passes an already-normalized
 * [options, callback] array to Socket.connect; that array must be read verbatim
 * (never re-normalized) so host/port are not lost.
 */
function socketTarget(args) {
  let options = {};
  if (Array.isArray(args[0])) {
    // Already-normalized [options, callback] array (from net.connect/createConnection).
    options = args[0][0] || {};
  } else if (args[0] && typeof args[0] === "object") {
    // connect(options[, cb])
    options = args[0];
  } else if (typeof args[0] === "number") {
    // connect(port[, host][, cb])
    options = { port: args[0] };
    if (typeof args[1] === "string") options.host = args[1];
  } else if (typeof args[0] === "string") {
    // connect(path[, cb]) -> Unix/IPC socket
    options = { path: args[0] };
  }

  if (options.path !== undefined && options.path !== null) {
    return { path: String(options.path) };
  }

  const host = options.host || options.hostname || "localhost";
  const rawPort = options.port;
  if (rawPort === undefined || rawPort === null) {
    return { error: "socket has no resolvable port" };
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { error: `invalid socket port ${rawPort}` };
  }
  return { host: String(host), port };
}

function appendSocketAudit(auditPath, host, port, allow) {
  if (!auditPath) return;
  try {
    appendFileSync(auditPath, `${JSON.stringify({ stage: "tcp", host, port, allow })}\n`, { mode: 0o600 });
  } catch {
    // Audit is best-effort and never blocks the request.
  }
}

function recordSocketTarget(host, port, allow) {
  if (!AUDIT_PATH) return;
  appendSocketAudit(AUDIT_PATH, host, port, allow);
}

/**
 * Final connection-boundary guard: every TCP socket must target the exact
 * registry host+port. A proxy/agent/lookup that changes the connection target
 * while the HTTP URL stays unchanged is therefore rejected before any connect.
 */
function guardSocketConnect(original, allowedTarget = ALLOWED_TARGET) {
  return function guardedSocketConnect(...args) {
    const target = socketTarget(args);
    if (target.error) {
      throw new Error(`NEXTY_RELEASE socket guard: ${target.error}`);
    }
    if (target.path !== undefined) {
      throw new Error("NEXTY_RELEASE socket guard: unix/ipc socket connections are not allowed");
    }
    if (!allowedTarget) {
      throw new Error("NEXTY_RELEASE socket guard: no allowed target configured");
    }
    const allow = normalizeHost(target.host) === allowedTarget.host && target.port === allowedTarget.port;
    recordSocketTarget(target.host, target.port, allow);
    if (!allow) {
      throw new Error(
        `NEXTY_RELEASE socket guard: tcp target ${target.host}:${target.port} is not allowed (expected ${allowedTarget.host}:${allowedTarget.port})`,
      );
    }
    return original.apply(this, args);
  };
}

function guardFetch(original, allowed = ALLOWED_ORIGIN) {
  return function guardedFetch(input, init) {
    const resolved = fetchOrigin(input);
    if (resolved.error) throw new Error(`NEXTY_RELEASE request guard: ${resolved.error}`);
    if (!isAllowedOrigin(resolved.origin, allowed)) {
      throw new Error(`NEXTY_RELEASE request guard: fetch origin ${resolved.origin} is not allowed (expected ${allowed})`);
    }
    let path = "";
    try {
      if (typeof input === "string") path = new URL(input).pathname;
      else if (input instanceof URL) path = input.pathname;
      else if (input && typeof input.url === "string") path = new URL(input.url).pathname;
    } catch {}
    recordTarget(resolved.origin, path);
    const opts = { ...(init || {}) };
    opts.redirect = "error";
    return original.call(this, input, opts);
  };
}

function guardRequest(original, protocol, allowed = ALLOWED_ORIGIN) {
  return function guardedRequest(input, options, callback) {
    const resolved = resolveOrigin(input, options, protocol);
    if (resolved.error) throw new Error(`NEXTY_RELEASE request guard: ${resolved.error}`);
    if (!isAllowedOrigin(resolved.origin, allowed)) {
      throw new Error(`NEXTY_RELEASE request guard: request origin ${resolved.origin} is not allowed (expected ${allowed})`);
    }
    let path = "";
    if (input instanceof URL) path = input.pathname;
    else if (typeof input === "string" && /^https?:\/\//i.test(input)) {
      try { path = new URL(input).pathname; } catch {}
    } else if (input && typeof input === "object" && typeof input.path === "string") path = input.path;
    if (!path && options && typeof options === "object" && typeof options.path === "string") path = options.path;
    recordTarget(resolved.origin, path);
    return original.call(this, input, options, callback);
  };
}

if (ALLOWED_ORIGIN) {
  if (typeof globalThis.fetch === "function") globalThis.fetch = guardFetch(globalThis.fetch);
  http.request = guardRequest(http.request, "http:");
  http.get = guardRequest(http.get, "http:");
  https.request = guardRequest(https.request, "https:");
  https.get = guardRequest(https.get, "https:");
  net.Socket.prototype.connect = guardSocketConnect(net.Socket.prototype.connect, ALLOWED_TARGET);
}

module.exports = {
  ALLOWED_ORIGIN,
  AUDIT_PATH,
  originOf,
  requestOrigin: resolveOrigin,
  resolveOrigin,
  fetchOrigin,
  isAllowedOrigin,
  assertAllowedOrigin,
  appendAudit,
  appendSocketAudit,
  parseAllowedTarget,
  socketTarget,
  guardSocketConnect,
  guardFetch,
  guardRequest,
};
