/**
 * Nano product configuration.
 *
 * Server-owned defaults. Clients never choose model/cost/provider; the model id
 * is read from configuration and the default cost is a product server value.
 */
export interface NanoServerConfig {
  model: string;
  cost: number;
  maxImageBytes: number;
  allowedMimeTypes: readonly string[];
  maxPromptLength: number;
  /** Per provider request timeout, milliseconds. */
  providerTimeoutMs: number;
  /**
   * Single-instance concurrency cap for the in-process dispatch sweeper. This
   * is NOT a cross-process global limit; a global limit would require a PG
   * coordination lease and is deliberately not claimed here.
   */
  maxConcurrentDispatches: number;
  /** Max tasks claimed from the queue per sweep. */
  dispatchBatchSize: number;
  /**
   * Lease lifetime for a claimed task. Must exceed the provider timeout so a
   * normal remote call does not expire its own claim.
   */
  leaseMs: number;
  /** Interval between in-process sweep cycles. */
  pollIntervalMs: number;
  /**
   * How long a task may stay `unknown` (no persisted result) before the
   * sweeper settles it as `failed` and refunds the original spend. A result
   * that arrives after that point is discarded, so a refunded task never also
   * delivers an image.
   */
  unknownRefundAfterMs: number;
}

/**
 * Safe, client-visible Nano configuration. This is the only Nano config shape
 * that may be serialized to the browser. It never contains the API key, model
 * id, or any raw provider configuration.
 */
export interface NanoPublicConfig {
  enabled: boolean;
  cost: number;
  maxPromptChars: number;
  maxImageBytes: number;
  allowedMimeTypes: readonly string[];
}

const DEFAULT_ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

const MIN_PROVIDER_TIMEOUT_MS = 1_000;
const MAX_PROVIDER_TIMEOUT_MS = 600_000;
const DEFAULT_PROVIDER_TIMEOUT_MS = 120_000;

const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 64;
const DEFAULT_CONCURRENCY = 4;

const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 200;
const DEFAULT_BATCH_SIZE = 10;

const MIN_LEASE_MS = 30_000;
const MAX_LEASE_MS = 3_600_000;
const DEFAULT_LEASE_MS = 180_000;

const MIN_UNKNOWN_REFUND_AFTER_MS = 60_000;
const MAX_UNKNOWN_REFUND_AFTER_MS = 86_400_000;
const DEFAULT_UNKNOWN_REFUND_AFTER_MS = 900_000;

const MIN_POLL_INTERVAL_MS = 1_000;
const MAX_POLL_INTERVAL_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

function boundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function getNanoServerConfig(): NanoServerConfig {
  const providerTimeoutMs = boundedInt(
    process.env.NANO_PROVIDER_TIMEOUT_MS,
    DEFAULT_PROVIDER_TIMEOUT_MS,
    MIN_PROVIDER_TIMEOUT_MS,
    MAX_PROVIDER_TIMEOUT_MS,
  );
  const leaseMs = boundedInt(
    process.env.NANO_LEASE_MS,
    DEFAULT_LEASE_MS,
    MIN_LEASE_MS,
    MAX_LEASE_MS,
  );
  if (leaseMs <= providerTimeoutMs) {
    throw new Error(
      `Nano server config invalid: NANO_LEASE_MS (${leaseMs}) must exceed ` +
        `NANO_PROVIDER_TIMEOUT_MS (${providerTimeoutMs})`,
    );
  }

  return {
    model: process.env.NANO_MODEL || "gemini-2.5-flash-image-preview",
    cost: 1,
    maxImageBytes: 5 * 1024 * 1024,
    allowedMimeTypes: DEFAULT_ALLOWED_MIME_TYPES,
    maxPromptLength: 4000,
    providerTimeoutMs,
    maxConcurrentDispatches: boundedInt(
      process.env.NANO_MAX_CONCURRENT_DISPATCHES,
      DEFAULT_CONCURRENCY,
      MIN_CONCURRENCY,
      MAX_CONCURRENCY,
    ),
    dispatchBatchSize: boundedInt(
      process.env.NANO_DISPATCH_BATCH_SIZE,
      DEFAULT_BATCH_SIZE,
      MIN_BATCH_SIZE,
      MAX_BATCH_SIZE,
    ),
    leaseMs,
    pollIntervalMs: boundedInt(
      process.env.NANO_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
      MIN_POLL_INTERVAL_MS,
      MAX_POLL_INTERVAL_MS,
    ),
    unknownRefundAfterMs: boundedInt(
      process.env.NANO_UNKNOWN_REFUND_AFTER_MS,
      DEFAULT_UNKNOWN_REFUND_AFTER_MS,
      MIN_UNKNOWN_REFUND_AFTER_MS,
      MAX_UNKNOWN_REFUND_AFTER_MS,
    ),
  };
}

/**
 * Server-side readiness check. A configured `GOOGLE_GENERATIVE_AI_API_KEY` is
 * required before any new Nano task can be accepted; this is separate from the
 * feature switch (`isNanoEnabled`) so a missing key closes admission without
 * exposing the raw key to the client.
 */
export function isNanoProviderConfigured(): boolean {
  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
}

/**
 * Server-only safe config projection for pages/navigation. Callers must resolve
 * this in a server page/layout and pass the plain DTO to the client; the client
 * never imports this module directly. `enabled` is the raw feature switch; the
 * projected `enabled` is false when the provider key is missing, so a
 * "turned-on but not ready" server never advertises an open admission path.
 */
export function getNanoPublicConfig(enabled: boolean): NanoPublicConfig {
  const server = getNanoServerConfig();
  return {
    enabled: enabled && isNanoProviderConfigured(),
    cost: server.cost,
    maxPromptChars: server.maxPromptLength,
    maxImageBytes: server.maxImageBytes,
    allowedMimeTypes: server.allowedMimeTypes,
  };
}
