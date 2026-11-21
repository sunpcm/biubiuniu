import { NextResponse } from "next/server";
import {
  NanoError,
  NanoIdempotencyConflictError,
  NanoInsufficientCreditsError,
  NanoInvalidInputError,
  NanoInvalidStateError,
  NanoTaskNotFoundError,
  NanoUnknownCaseError,
} from "@sunpcm/niu-feature-nano";
import { InsufficientCreditsError } from "@sunpcm/niu-commerce";

interface NanoErrorEnvelope {
  status: number;
  code: string;
  message: string;
}

function classify(error: unknown): NanoErrorEnvelope {
  if (error instanceof NanoUnknownCaseError) {
    return { status: 400, code: "UNKNOWN_CASE", message: error.message };
  }
  if (error instanceof NanoInvalidInputError) {
    return { status: 400, code: "INVALID_INPUT", message: error.message };
  }
  if (error instanceof NanoInsufficientCreditsError || error instanceof InsufficientCreditsError) {
    return { status: 402, code: "INSUFFICIENT_CREDITS", message: "Insufficient credits" };
  }
  if (error instanceof NanoIdempotencyConflictError) {
    return { status: 409, code: "IDEMPOTENCY_CONFLICT", message: error.message };
  }
  if (error instanceof NanoTaskNotFoundError) {
    return { status: 404, code: "NOT_FOUND", message: error.message };
  }
  if (error instanceof NanoInvalidStateError) {
    return { status: 409, code: "INVALID_STATE", message: error.message };
  }
  if (error instanceof NanoError) {
    return { status: 400, code: error.code, message: error.message };
  }
  // Never surface raw SDK/stack/base64. Only a stable code and correlation id
  // are safe; the caller logs the sanitized error separately.
  return { status: 500, code: "INTERNAL", message: "Nano request failed" };
}

export function nanoErrorResponse(error: unknown): NextResponse {
  const { status, code, message } = classify(error);
  return NextResponse.json(
    { success: false, error: message, code },
    { status },
  );
}

export function nanoErrorEnvelope(error: unknown): NanoErrorEnvelope {
  return classify(error);
}

export function nanoDisabledResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: "Nano is disabled", code: "NANO_DISABLED" },
    { status: 503 },
  );
}

export function nanoAuthRequiredResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: "Authentication required", code: "AUTH_REQUIRED" },
    { status: 401 },
  );
}
