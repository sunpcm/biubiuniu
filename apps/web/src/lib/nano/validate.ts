import {
  NanoInvalidInputError,
  NanoUnknownCaseError,
  type NanoCaseCatalog,
} from "@sunpcm/niu-feature-nano";
import type { NanoServerConfig } from "@/config/nano";

export interface ValidAdmitInput {
  prompt: string;
  image: string;
  mimeType: string;
  caseId: string | null;
  requestKey: string | null;
}

const BASE64_BODY_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64_URLSAFE_RE = /^[A-Za-z0-9_-]+={0,2}$/;
const MAX_REQUEST_KEY_LENGTH = 200;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46] as const; // "RIFF"
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50] as const; // "WEBP" at offset 8

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NanoInvalidInputError(`${label} is required`);
  }
  return value;
}

function startsWith(bytes: Buffer, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i += 1) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

/**
 * Decode base64 strictly. `Buffer.from(base64)` is lenient (it silently drops
 * invalid characters and decodes partial input), so a round-trip re-encode is
 * used to reject any payload that only decodes because of that leniency.
 * Standard and URL-safe alphabets are accepted; padding is tolerated.
 */
export function decodeBase64Strict(data: string): Buffer {
  if (!BASE64_BODY_RE.test(data) && !BASE64_URLSAFE_RE.test(data)) {
    throw new NanoInvalidInputError("image must be raw base64 bytes");
  }
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const buffer = Buffer.from(normalized, "base64");
  const reEncoded = buffer.toString("base64").replace(/=+$/, "");
  if (reEncoded !== normalized.replace(/=+$/, "")) {
    throw new NanoInvalidInputError("image is not valid base64");
  }
  return buffer;
}

/** Verify the decoded bytes carry the magic signature the declared MIME claims. */
export function validateImageBytes(bytes: Buffer, mimeType: string): void {
  if (bytes.length === 0) {
    throw new NanoInvalidInputError("image is empty");
  }
  if (mimeType === "image/png") {
    if (!startsWith(bytes, PNG_MAGIC)) {
      throw new NanoInvalidInputError("image bytes do not match image/png");
    }
    return;
  }
  if (mimeType === "image/jpeg") {
    if (!startsWith(bytes, JPEG_MAGIC)) {
      throw new NanoInvalidInputError("image bytes do not match image/jpeg");
    }
    return;
  }
  if (mimeType === "image/webp") {
    if (bytes.length < 12 || !startsWith(bytes, RIFF_MAGIC) || !startsWith(bytes.subarray(8, 12), WEBP_MAGIC)) {
      throw new NanoInvalidInputError("image bytes do not match image/webp");
    }
    return;
  }
  throw new NanoInvalidInputError("mimeType is not allowed");
}

export function validateAdmitBody(
  body: unknown,
  config: NanoServerConfig,
  caseCatalog: NanoCaseCatalog,
  options: { requireRequestKey?: boolean } = {},
): ValidAdmitInput {
  if (typeof body !== "object" || body === null) {
    throw new NanoInvalidInputError("Request body is required");
  }
  const input = body as Record<string, unknown>;

  const prompt = requireString(input.prompt, "prompt").trim();
  if (prompt.length > config.maxPromptLength) {
    throw new NanoInvalidInputError(`prompt exceeds ${config.maxPromptLength} characters`);
  }

  const image = requireString(input.image, "image");
  const imageBytes = decodeBase64Strict(image);
  if (imageBytes.length > config.maxImageBytes) {
    throw new NanoInvalidInputError(`image exceeds ${config.maxImageBytes} bytes`);
  }

  const mimeType = requireString(input.mimeType, "mimeType").trim();
  if (!config.allowedMimeTypes.includes(mimeType)) {
    throw new NanoInvalidInputError("mimeType is not allowed");
  }
  validateImageBytes(imageBytes, mimeType);

  let requestKey: string | null = null;
  const requireRequestKey = options.requireRequestKey !== false;
  if (requireRequestKey) {
    const candidate = requireString(input.requestKey, "requestKey");
    if (candidate.length > MAX_REQUEST_KEY_LENGTH) {
      throw new NanoInvalidInputError("requestKey is too long");
    }
    requestKey = candidate;
  } else if (input.requestKey !== undefined && input.requestKey !== null) {
    const candidate = requireString(input.requestKey, "requestKey");
    if (candidate.length > MAX_REQUEST_KEY_LENGTH) {
      throw new NanoInvalidInputError("requestKey is too long");
    }
    requestKey = candidate;
  }

  let caseId: string | null = null;
  if (input.caseId !== undefined && input.caseId !== null) {
    const candidate = requireString(input.caseId, "caseId").trim();
    if (!caseCatalog.has(candidate)) {
      throw new NanoUnknownCaseError(candidate);
    }
    caseId = candidate;
  }

  return { prompt, image, mimeType, caseId, requestKey };
}

export interface ValidCaseSelection {
  caseId: string;
  requestKey: string;
}

export function validateCaseSelectionBody(
  body: unknown,
  caseCatalog: NanoCaseCatalog,
): ValidCaseSelection {
  if (typeof body !== "object" || body === null) {
    throw new NanoInvalidInputError("Request body is required");
  }
  const input = body as Record<string, unknown>;
  const caseId = requireString(input.caseId, "caseId").trim();
  if (!caseCatalog.has(caseId)) {
    throw new NanoUnknownCaseError(caseId);
  }
  const requestKey = requireString(input.requestKey, "requestKey");
  if (requestKey.length > MAX_REQUEST_KEY_LENGTH) {
    throw new NanoInvalidInputError("requestKey is too long");
  }
  return { caseId, requestKey };
}
