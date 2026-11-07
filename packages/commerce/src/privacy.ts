export const REDACTED = "[Redacted]";

const CIRCULAR = "[Circular]";
const UNSUPPORTED = "[Unsupported]";
const MAX_DEPTH = 16;

const SENSITIVE_KEYS = new Set([
  "authorization", "authorizationheader", "cookie", "cookieheader", "setcookie",
  "password", "passwordhash", "passwd", "pwd", "token", "tokens", "accesstoken",
  "refreshtoken", "idtoken", "authtoken", "sessiontoken", "sessionid", "apitoken",
  "apikey", "apisecret", "apisecretkey", "secret", "secretkey", "clientsecret",
  "passphrase", "privatekey", "webhooksecret", "signingsecret", "signingkey",
  "hmacsecret", "jwtsecret", "jwt", "bearer", "credential", "credentials",
  "databaseurl", "redisurl", "connectionstring", "connectionuri", "dsn",
  "accesskey", "accesskeyid", "awsaccesskey", "awsaccesskeyid", "awssecretaccesskey",
  "awssecretaccesskeyid", "secretaccesskey",
]);

const AUTH_SCHEME = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const AUTH_HEADER = /(\b(?:authorization|proxy-authorization)\b\s*[:=]\s*)(?:(?:Bearer|Basic)\s+)?[^\s,;&]+/gi;
const URL_USERINFO = /\b((?:https?|postgres(?:ql)?|rediss?|mongodb(?:\+srv)?):\/\/)[^\s/@]+@/gi;
const KEY_VALUE = /(\b(?:(?:aws[-_ ]?)?secret[-_ ]?access[-_ ]?key(?:[-_ ]?id)?|(?:aws[-_ ]?)?access[-_ ]?key(?:[-_ ]?id)?|authorization|proxy-authorization|cookie|set-cookie|password|passwd|pwd|api[-_ ]?key|api[-_ ]?secret|access[-_ ]?token|refresh[-_ ]?token|id[-_ ]?token|auth[-_ ]?token|session[-_ ]?token|token|client[-_ ]?secret|private[-_ ]?key|secret|connection[-_ ]?string|database[-_ ]?url|redis[-_ ]?url|dsn)\b["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)/gi;

function canonical(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sensitiveKey(key: string): boolean {
  const value = canonical(key);
  return SENSITIVE_KEYS.has(value) ||
    ["password", "passwordhash", "token", "apikey", "secret", "secretkey", "privatekey", "signingkey", "accesskey", "accesskeyid", "sessionid", "credential", "credentials", "connectionstring", "connectionuri"]
      .some((suffix) => value.endsWith(suffix));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeLogText(value: string): string {
  return value
    .replace(AUTH_HEADER, (_match, prefix: string) => `${prefix}${REDACTED}`)
    .replace(AUTH_SCHEME, (_match, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(URL_USERINFO, (_match, prefix: string) => `${prefix}${REDACTED}@`)
    .replace(KEY_VALUE, (_match, prefix: string) => `${prefix}${REDACTED}`);
}

function sanitizeError(error: Error, seen: WeakMap<object, unknown>, depth: number): Error {
  const safe = new Error(sanitizeLogText(error.message));
  seen.set(error, safe);
  safe.name = sanitizeLogText(error.name);
  safe.stack = error.stack ? sanitizeLogText(error.stack) : undefined;
  for (const [key, value] of Object.entries(error)) {
    if (key === "toJSON" || key === "message" || key === "name" || key === "stack") continue;
    (safe as unknown as Record<string, unknown>)[key] = sensitiveKey(key) ? REDACTED : sanitizeValue(value, seen, depth + 1);
  }
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause !== undefined) safe.cause = sanitizeValue(cause, seen, depth + 1);
  return safe;
}

function sanitizeValue(value: unknown, seen: WeakMap<object, unknown>, depth: number): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return sanitizeLogText(value);
  if (typeof value === "bigint") return value.toString();
  if (value === undefined) return undefined;
  if (typeof value === "function" || typeof value === "symbol") return UNSUPPORTED;
  if (depth >= MAX_DEPTH) return "[MaxDepth]";
  if (seen.has(value)) return CIRCULAR;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof URL) return sanitizeLogText(value.toString());
  const bufferApi = (globalThis as { Buffer?: { isBuffer(value: unknown): value is { byteLength: number } } }).Buffer;
  if (bufferApi?.isBuffer(value)) return `[Buffer ${value.byteLength} bytes]`;
  if (value instanceof Error) return sanitizeError(value, seen, depth);
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(sanitizeValue(item, seen, depth + 1));
    return copy;
  }
  if (value instanceof Map) {
    const copy: Record<string, unknown> = {};
    seen.set(value, copy);
    for (const [key, item] of value) {
      const safeKey = sanitizeLogText(String(key));
      copy[safeKey] = sensitiveKey(String(key)) ? REDACTED : sanitizeValue(item, seen, depth + 1);
    }
    return copy;
  }
  if (value instanceof Set) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(sanitizeValue(item, seen, depth + 1));
    return copy;
  }
  if (!isRecord(value)) return String(value);
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) {
    copy[key] = sensitiveKey(key) ? REDACTED : sanitizeValue(item, seen, depth + 1);
  }
  return copy;
}

export function sanitizeLogData(value: object): Record<string, unknown> {
  const safe = sanitizeValue(value, new WeakMap(), 0);
  if (safe instanceof Error) {
    return { name: safe.name, message: safe.message, stack: safe.stack, ...Object.fromEntries(Object.entries(safe)) };
  }
  return isRecord(safe) ? safe : { value: safe };
}

export function sanitizeLogError(error: Error): Error {
  return sanitizeError(error, new WeakMap(), 0);
}

export function safeUnknownError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    const safe = sanitizeLogError(error);
    return { name: safe.name, message: safe.message, stack: safe.stack };
  }
  if (typeof error === "string") return { name: "Error", message: sanitizeLogText(error) };
  if (isRecord(error) && typeof error.message === "string") {
    return { name: "Error", message: sanitizeLogText(error.message) };
  }
  return { name: "Error", message: "Unknown billing error" };
}
