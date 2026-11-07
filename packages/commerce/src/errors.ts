export class InsufficientCreditsError extends Error {
  constructor(requested: number, available: number) {
    super(`Insufficient credits: requested ${requested}, available ${available}`);
    this.name = "InsufficientCreditsError";
  }
}

export class PermanentFulfillmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentFulfillmentError";
  }
}

export class RefundHistoryIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefundHistoryIncompleteError";
  }
}

export class DuplicateRefundFailedError extends Error {
  readonly cause: unknown;
  constructor(provider: string, providerOrderId: string, cause: unknown) {
    super(`Duplicate subscription payment ${provider}/${providerOrderId} could not be auto-refunded — retrying via webhook; refund manually if this persists`);
    this.name = "DuplicateRefundFailedError";
    this.cause = cause;
  }
}

export interface PublicBillingResult {
  status: number;
  body: { error: string };
  retry: boolean;
}

/** Stable HTTP body. Raw provider/SDK messages and stacks never leave the process. */
export function publicBillingFailure(error: unknown): PublicBillingResult {
  if (error instanceof PermanentFulfillmentError) {
    return { status: 200, body: { error: "Permanent billing failure" }, retry: false };
  }
  return { status: 500, body: { error: "Temporary billing failure" }, retry: true };
}
