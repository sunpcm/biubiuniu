/**
 * Nano domain errors.
 *
 * The package does not read `process.env`, open a database connection, or import
 * a provider SDK at the root. Errors below are thrown by the pure core usecases
 * and classified by the app route layer into the frozen HTTP contract.
 */
export type NanoErrorCode =
  | "INVALID_INPUT"
  | "UNKNOWN_CASE"
  | "INSUFFICIENT_CREDITS"
  | "IDEMPOTENCY_CONFLICT"
  | "NOT_FOUND"
  | "INVALID_STATE";

export class NanoError extends Error {
  readonly code: NanoErrorCode;
  constructor(code: NanoErrorCode, message: string) {
    super(message);
    this.name = "NanoError";
    this.code = code;
  }
}

export class NanoInvalidInputError extends NanoError {
  constructor(message: string) {
    super("INVALID_INPUT", message);
    this.name = "NanoInvalidInputError";
  }
}

export class NanoUnknownCaseError extends NanoError {
  constructor(caseId: string) {
    super("UNKNOWN_CASE", `Unknown Nano case: ${caseId}`);
    this.name = "NanoUnknownCaseError";
  }
}

export class NanoIdempotencyConflictError extends NanoError {
  constructor() {
    super("IDEMPOTENCY_CONFLICT", "The same requestKey was reused with different content");
    this.name = "NanoIdempotencyConflictError";
  }
}

export class NanoTaskNotFoundError extends NanoError {
  constructor() {
    super("NOT_FOUND", "Nano task not found or not owned by this subject");
    this.name = "NanoTaskNotFoundError";
  }
}

export class NanoInvalidStateError extends NanoError {
  constructor(message: string) {
    super("INVALID_STATE", message);
    this.name = "NanoInvalidStateError";
  }
}

/** An insufficient-credits signal raised by the commerce spend port. */
export class NanoInsufficientCreditsError extends NanoError {
  constructor(message: string) {
    super("INSUFFICIENT_CREDITS", message);
    this.name = "NanoInsufficientCreditsError";
  }
}
