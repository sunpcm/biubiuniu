/**
 * Minimal cross-boundary error contract.
 *
 * Domain packages keep their own concrete error classes; this base exists so
 * adapters and application assembly can classify an arbitrary thrown value
 * into a stable machine-readable kind and retry policy without importing a
 * specific domain implementation.
 */

export type ErrorKind =
  | "validation"
  | "conflict"
  | "not_found"
  | "permission"
  | "unavailable"
  | "internal";

export interface AppErrorOptions {
  /** Stable, machine-readable code owned by the throwing package. */
  code: string;
  kind: ErrorKind;
  /** Whether a caller may safely retry the same operation later. */
  retryable: boolean;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly kind: ErrorKind;
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(message: string, options: AppErrorOptions) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = options.code;
    this.kind = options.kind;
    this.retryable = options.retryable;
    this.cause = options.cause;
  }
}
