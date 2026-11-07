/**
 * [INPUT]: no external dependencies; pure utility functions
 * [OUTPUT]: exports withRetry (delayed retry wrapper) and isRetryableHttpError (HTTP status classifier)
 * [POS]: lib/mail resilience layer, consumed by resend and cloudflare providers
 * [PROTOCOL]: Update this header when changed, then check CLAUDE.md
 */

const RETRY_DELAY_MS = 2000;

export async function withRetry<T>(
  fn: () => Promise<T>,
  isRetryable: (error: unknown) => boolean
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isRetryable(error)) throw error;
    await sleep(RETRY_DELAY_MS);
    return fn();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableHttpError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const status =
      (error as { status?: number }).status ??
      (error as { statusCode?: number }).statusCode;
    if (typeof status === "number") {
      return status === 429 || status >= 500;
    }
  }
  // Network-like errors are retried once by default.
  return true;
}
