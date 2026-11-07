import type {
  NanoCaseStats,
  NanoPublicConfig,
  NanoTask,
} from "./types";

/** Canonical prefix consumed by `useNanoTask`; the hook appends `/tasks`. */
export const NANO_API_BASE = "/api/nano";
export const NANO_LIST_PAGE_SIZE = 20;
export const NANO_LOCAL_TASK_KEY = "nexty:nano:last-task-id:v1";

export const NANO_ERROR_CODES = [
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "NANO_DISABLED",
  "INVALID_INPUT",
  "UNKNOWN_CASE",
  "INSUFFICIENT_CREDITS",
  "IDEMPOTENCY_CONFLICT",
  "NOT_FOUND",
  "INVALID_STATE",
  "INTERNAL",
  "NETWORK_ERROR",
  "ABORTED",
] as const;

export type NanoErrorCode =
  | (typeof NANO_ERROR_CODES)[number]
  | (string & {});

export interface NanoClientError {
  status: number;
  code: NanoErrorCode;
  message: string;
}

export function toNanoClientError(error: unknown): NanoClientError {
  if (error && typeof error === "object") {
    const candidate = error as {
      status?: unknown;
      code?: unknown;
      message?: unknown;
    };
    return {
      status: typeof candidate.status === "number" ? candidate.status : 0,
      code:
        typeof candidate.code === "string" && candidate.code
          ? candidate.code
          : "INTERNAL",
      message:
        typeof candidate.message === "string"
          ? candidate.message
          : "Nano request failed",
    };
  }
  return { status: 0, code: "INTERNAL", message: "Nano request failed" };
}

export function createRequestKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `nano-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * UI-only replay fingerprint. The server still owns the authoritative
 * idempotency digest; this value only prevents reusing a requestKey after the
 * user edits the prompt, image, MIME type or case selection.
 */
export function nanoInputFingerprint(input: {
  prompt: string;
  image: string;
  mimeType: string;
  caseId?: string;
}): string {
  const text = JSON.stringify([
    input.prompt,
    input.image,
    input.mimeType,
    input.caseId ?? null,
  ]);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length.toString(16)}-${(hash >>> 0).toString(16)}`;
}

export function validateNanoInput(
  input: { prompt: string; mimeType: string; imageBytes: number; caseId?: string },
  config: NanoPublicConfig,
): NanoErrorCode | null {
  if (!input.prompt.trim() || input.prompt.length > config.maxPromptChars) {
    return "INVALID_INPUT";
  }
  if (!input.mimeType || !config.allowedMimeTypes.includes(input.mimeType)) {
    return "INVALID_INPUT";
  }
  if (input.imageBytes <= 0 || input.imageBytes > config.maxImageBytes) {
    return "INVALID_INPUT";
  }
  if (input.caseId && !isStableCaseId(input.caseId)) {
    return "UNKNOWN_CASE";
  }
  return null;
}

/** The static product allowlist uses case1..case47 in source order. */
export function isStableCaseId(caseId: string): boolean {
  return /^case(?:[1-9]|[1-3][0-9]|4[0-7])$/.test(caseId);
}

export function nanoResultImageSource(image: NanoResultImageLike): string | null {
  if (image.kind === "inline") {
    return `data:${image.mimeType};base64,${image.dataBase64}`;
  }
  return image.url.startsWith("/api/nano/") ? image.url : null;
}

export function nanoResultImageAlt(
  image: NanoResultImageLike,
  index: number,
): string {
  return image.kind === "inline"
    ? `${image.mimeType} result ${index + 1}`
    : `Nano result ${index + 1}`;
}

type NanoResultImageLike = NonNullable<NanoTask["result"]>["images"][number];

export function isNanoTask(value: unknown): value is NanoTask {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<NanoTask>;
  return (
    typeof item.taskId === "string" &&
    typeof item.status === "string" &&
    typeof item.cost === "number" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string" &&
    (item.result === null ||
      (typeof item.result === "object" &&
        Array.isArray(item.result.images)))
  );
}

export function isNanoCaseStats(value: unknown): value is NanoCaseStats {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<NanoCaseStats>;
  return Array.isArray(item.topCases) && typeof item.stats === "object";
}

/** Pure guard for the public config DTO; used by the server -> client boundary. */
export function assertPublicNanoConfig(config: NanoPublicConfig): NanoPublicConfig {
  const forbiddenKeys = ["apiKey", "model", "provider", "raw"];
  for (const key of forbiddenKeys) {
    if (key in config) {
      throw new Error(`Nano public config leaked ${key}`);
    }
  }
  return config;
}
