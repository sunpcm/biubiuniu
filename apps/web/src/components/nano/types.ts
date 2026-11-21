/**
 * UI-side shapes for the frozen Nano public contract. Only these DTOs and the
 * `@sunpcm/niu-feature-nano/react` public entry are used by the product UI.
 */

export type NanoTaskStatus =
  | "queued"
  | "leased"
  | "dispatching"
  | "running"
  | "unknown"
  | "succeeded"
  | "failed"
  | "canceled";

/** The server-resolved safe projection; never carries keys/model/provider. */
export interface NanoPublicConfig {
  enabled: boolean;
  cost: number;
  maxPromptChars: number;
  maxImageBytes: number;
  allowedMimeTypes: readonly string[];
}

export type NanoResultImage =
  | { kind: "inline"; mimeType: string; dataBase64: string }
  | { kind: "object"; url: string };

export interface NanoTaskResult {
  images: NanoResultImage[];
  text: string | null;
}

export interface NanoTask {
  taskId: string;
  status: NanoTaskStatus;
  cost: number;
  result: NanoTaskResult | null;
  createdAt: string;
  updatedAt: string;
}

export interface NanoTaskSummary {
  taskId: string;
  status: NanoTaskStatus;
  cost: number;
  createdAt: string;
  updatedAt: string;
}

export interface NanoTaskList {
  tasks: NanoTaskSummary[];
  nextCursor: string | null;
}

export interface NanoAdmitResult {
  taskId: string;
  status: NanoTaskStatus;
  created: boolean;
  cost: number;
}

export interface NanoCaseStats {
  topCases: readonly string[];
  stats: Readonly<Record<string, number>>;
}
