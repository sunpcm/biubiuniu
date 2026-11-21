import semver from "semver";

import { ReleaseError, ERROR_CODES } from "./errors.mjs";

export default semver;

export const {
  satisfies,
  valid,
  validRange,
  parse,
  prerelease,
  eq,
  neq,
  gt,
  gte,
  lt,
  lte,
  compare,
  clean,
} = semver;

export function parseVersion(input) {
  const s = typeof input === "string" ? semver.parse(input.trim()) : null;
  if (!s) return null;
  return {
    major: s.major,
    minor: s.minor,
    patch: s.patch,
    prerelease: s.prerelease,
    build: s.build,
    raw: input.trim(),
  };
}

/** A bare, exact version (`1.2.3` or `1.2.3-next.0`). */
export function isExact(input) {
  return typeof input === "string" && semver.valid(input) !== null;
}

/** A valid semver range that is not a bare exact version. */
export function isRange(input) {
  return typeof input === "string" && semver.valid(input) === null && semver.validRange(input) !== null;
}

/** A bare exact version with a prerelease segment. */
export function isPrerelease(input) {
  return semver.prerelease(input) !== null;
}

/** A bare exact version with no prerelease segment (a real stable version). */
export function isStableVersion(input) {
  const s = typeof input === "string" ? semver.parse(input.trim()) : null;
  return s !== null && s.prerelease.length === 0;
}

export function sortVersions(versions) {
  return [...versions].sort(semver.compare);
}

export function assertExactVersion(value, what) {
  if (!isExact(value)) {
    throw new ReleaseError(
      ERROR_CODES.SEMVER,
      `${what} must be an exact version, got: ${value}`,
      { value },
    );
  }
  return semver.clean(value);
}
