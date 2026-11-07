import { REDACTED_LOG_VALUE } from "./options";

const CIRCULAR_LOG_VALUE = "[Circular]";
const UNSUPPORTED_LOG_VALUE = "[Unsupported]";
const MAX_SANITIZE_DEPTH = 16;

const SENSITIVE_LOG_KEYS = new Set([
  "authorization",
  "authorizationheader",
  "cookie",
  "cookieheader",
  "setcookie",
  "password",
  "passwordhash",
  "passwd",
  "pwd",
  "token",
  "tokens",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authtoken",
  "sessiontoken",
  "sessionid",
  "apitoken",
  "apikey",
  "apisecret",
  "apisecretkey",
  "secret",
  "secretkey",
  "clientsecret",
  "passphrase",
  "privatekey",
  "webhooksecret",
  "signingsecret",
  "signingkey",
  "hmacsecret",
  "jwtsecret",
  "jwt",
  "bearer",
  "credential",
  "credentials",
  "databaseurl",
  "redisurl",
  "connectionstring",
  "connectionuri",
  "dsn",
  "accesskey",
  "accesskeyid",
  "awsaccesskey",
  "awsaccesskeyid",
  "awssecretaccesskey",
  "awssecretaccesskeyid",
  "secretaccesskey",
]);

const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const AUTH_HEADER_PATTERN =
  /(\b(?:authorization|proxy-authorization)\b\s*[:=]\s*)(?:(?:Bearer|Basic)\s+)?[^\s,;&]+/gi;
const URL_USERINFO_PATTERN =
  /\b((?:https?|postgres(?:ql)?|rediss?|mongodb(?:\+srv)?):\/\/)[^\s/@]+@/gi;
const KEY_VALUE_PATTERN =
  /(\b(?:(?:aws[-_ ]?)?secret[-_ ]?access[-_ ]?key(?:[-_ ]?id)?|(?:aws[-_ ]?)?access[-_ ]?key(?:[-_ ]?id)?|authorization|proxy-authorization|cookie|set-cookie|password|passwd|pwd|api[-_ ]?key|api[-_ ]?secret|access[-_ ]?token|refresh[-_ ]?token|id[-_ ]?token|auth[-_ ]?token|session[-_ ]?token|token|client[-_ ]?secret|private[-_ ]?key|secret|connection[-_ ]?string|database[-_ ]?url|redis[-_ ]?url|dsn)\b["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)/gi;

function canonicalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveLogKey(key: string): boolean {
  const canonical = canonicalizeKey(key);
  return (
    SENSITIVE_LOG_KEYS.has(canonical) ||
    canonical.endsWith("password") ||
    canonical.endsWith("passwordhash") ||
    canonical.endsWith("token") ||
    canonical.endsWith("apikey") ||
    canonical.endsWith("secret") ||
    canonical.endsWith("secretkey") ||
    canonical.endsWith("privatekey") ||
    canonical.endsWith("signingkey") ||
    canonical.endsWith("accesskey") ||
    canonical.endsWith("accesskeyid") ||
    canonical.endsWith("sessionid") ||
    canonical.endsWith("credential") ||
    canonical.endsWith("credentials") ||
    canonical.endsWith("connectionstring") ||
    canonical.endsWith("connectionuri")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Redact credentials that are commonly embedded in otherwise free-form text.
 * This intentionally does not attempt to identify unlabelled arbitrary secrets.
 */
export function sanitizeLogText(value: string): string {
  return value
    .replace(AUTH_HEADER_PATTERN, (_match, prefix: string) => `${prefix}${REDACTED_LOG_VALUE}`)
    .replace(AUTH_SCHEME_PATTERN, (_match, scheme: string) => `${scheme} ${REDACTED_LOG_VALUE}`)
    .replace(URL_USERINFO_PATTERN, (_match, prefix: string) => `${prefix}${REDACTED_LOG_VALUE}@`)
    .replace(KEY_VALUE_PATTERN, (_match, prefix: string) => `${prefix}${REDACTED_LOG_VALUE}`);
}

function sanitizeError(error: Error, seen: WeakMap<object, unknown>, depth: number): Error {
  const safeError = new Error(sanitizeLogText(error.message));
  seen.set(error, safeError);

  safeError.name = sanitizeLogText(error.name);
  safeError.stack = error.stack ? sanitizeLogText(error.stack) : undefined;

  for (const [key, value] of Object.entries(error)) {
    if (key === "toJSON" || key === "message" || key === "name" || key === "stack") continue;
    (safeError as unknown as Record<string, unknown>)[key] = isSensitiveLogKey(key)
      ? REDACTED_LOG_VALUE
      : sanitizeLogValue(value, seen, depth + 1);
  }

  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause !== undefined) {
    safeError.cause = sanitizeLogValue(cause, seen, depth + 1);
  }

  return safeError;
}

function sanitizeLogValue(value: unknown, seen: WeakMap<object, unknown>, depth: number): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") return sanitizeLogText(value);
  if (typeof value === "bigint") return value.toString();
  if (value === undefined) return undefined;
  if (typeof value === "function" || typeof value === "symbol") return UNSUPPORTED_LOG_VALUE;
  if (depth >= MAX_SANITIZE_DEPTH) return "[MaxDepth]";
  if (seen.has(value)) return CIRCULAR_LOG_VALUE;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof URL) return sanitizeLogText(value.toString());
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return `[Buffer ${value.byteLength} bytes]`;
  }
  if (value instanceof Error) return sanitizeError(value, seen, depth);

  if (Array.isArray(value)) {
    const safeArray: unknown[] = [];
    seen.set(value, safeArray);
    for (const item of value) safeArray.push(sanitizeLogValue(item, seen, depth + 1));
    return safeArray;
  }

  if (value instanceof Map) {
    const safeMap: Record<string, unknown> = {};
    seen.set(value, safeMap);
    for (const [key, item] of value) {
      const safeKey = sanitizeLogText(String(key));
      safeMap[safeKey] = isSensitiveLogKey(String(key))
        ? REDACTED_LOG_VALUE
        : sanitizeLogValue(item, seen, depth + 1);
    }
    return safeMap;
  }

  if (value instanceof Set) {
    const safeSet: unknown[] = [];
    seen.set(value, safeSet);
    for (const item of value) safeSet.push(sanitizeLogValue(item, seen, depth + 1));
    return safeSet;
  }

  if (!isRecord(value)) return String(value);

  const safeRecord: Record<string, unknown> = {};
  seen.set(value, safeRecord);
  for (const [key, item] of Object.entries(value)) {
    safeRecord[key] = isSensitiveLogKey(key)
      ? REDACTED_LOG_VALUE
      : sanitizeLogValue(item, seen, depth + 1);
  }
  return safeRecord;
}

/** Clone a structured log payload into a new, sanitized object. */
export function sanitizeLogData(value: object): Record<string, unknown> {
  const safe = sanitizeLogValue(value, new WeakMap(), 0);
  if (safe instanceof Error) {
    return {
      name: safe.name,
      message: safe.message,
      stack: safe.stack,
      ...Object.fromEntries(Object.entries(safe)),
    };
  }
  if (isRecord(safe)) return safe;
  return { value: safe };
}

/** Clone an Error into a sanitized Error suitable for Pino and Sentry. */
export function sanitizeLogError(error: Error): Error {
  return sanitizeError(error, new WeakMap(), 0);
}

/** Return a sanitized copy of the first nested Error, if present. */
export function findNestedError(value: object, seen = new WeakSet<object>()): Error | null {
  if (value instanceof Error) return value;
  if (seen.has(value)) return null;
  seen.add(value);

  for (const item of Object.values(value)) {
    if (item instanceof Error) return item;
    if (Array.isArray(item)) {
      for (const child of item) {
        if (child instanceof Error) return child;
        if (child && typeof child === "object") {
          const nested = findNestedError(child, seen);
          if (nested) return nested;
        }
      }
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const nested = findNestedError(item, seen);
      if (nested) return nested;
    }
  }

  return null;
}
