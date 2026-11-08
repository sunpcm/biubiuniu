/**
 * Structured error used across the release tooling. Every failure carries a
 * stable `code` so callers (and the CLI) can classify it without parsing
 * messages, plus an optional `details` object for machine-readable context.
 */
export class ReleaseError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ReleaseError";
    this.code = code;
    this.details = details;
  }
}

export const ERROR_CODES = Object.freeze({
  USAGE: "USAGE",
  CONFIG: "CONFIG",
  TAR: "TAR",
  SEMVER: "SEMVER",
  VERIFY: "VERIFY",
  MANIFEST: "MANIFEST",
  STABLE: "STABLE",
  URL: "URL",
  REGISTRY: "REGISTRY",
  PROMOTE: "PROMOTE",
  GATE: "GATE",
  IO: "IO",
});
