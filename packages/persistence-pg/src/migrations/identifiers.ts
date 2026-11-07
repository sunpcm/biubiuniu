/**
 * Safe PostgreSQL identifier handling.
 *
 * Identifiers (journal/profile table names) are validated against a strict,
 * conservative pattern and rejected before any SQL is assembled. This keeps a
 * malformed or malicious identifier from ever reaching the wire as part of a
 * query.
 */

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Throws unless `value` is a conservative, unquoted PostgreSQL identifier. */
export function assertSafeIdentifier(value: string, what: string): void {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(
      `${what} is not a safe identifier: ${JSON.stringify(value)}`,
    );
  }
}

/**
 * Quote an already-validated identifier. Defensive double-quoting so reserved
 * words remain unambiguous; the validation above already forbids quotes and
 * whitespace.
 */
export function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
