/**
 * Thin React client hook for the frozen Nano HTTP contract (v2).
 *
 * `useNanoTask("/api/nano")` is the canonical call: `apiBase` is the prefix up
 * to (not including) the route path, and this hook appends `/tasks` and friends.
 * Every method resolves to the already-unwrapped HTTP `data` object; failures
 * throw a sanitized `NanoHttpError` carrying `status`, `code`, and `message`
 * (never a raw provider error).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { NanoTaskStatus } from "./core.js";

export interface NanoAdmitPayload {
  prompt: string;
  /** Base64 image bytes. Required. */
  image: string;
  mimeType: string;
  /** Optional; when present the server validates it against the allowlist. */
  caseId?: string;
  requestKey: string;
}

export type NanoResultImage =
  | { kind: "inline"; mimeType: string; dataBase64: string }
  | { kind: "object"; url: string };

export interface NanoTaskResultDto {
  images: NanoResultImage[];
  text: string | null;
}

export interface NanoTaskDto {
  taskId: string;
  status: NanoTaskStatus;
  cost: number;
  result: NanoTaskResultDto | null;
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

export interface NanoTaskListDto {
  tasks: NanoTaskSummary[];
  nextCursor: string | null;
}

export class NanoHttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "NanoHttpError";
    this.status = status;
    this.code = code;
  }
}

export interface NanoAdmitOptions {
  signal?: AbortSignal;
}

export interface NanoGetOptions {
  signal?: AbortSignal;
}

export interface NanoListOptions {
  pageSize?: number;
  nextCursor?: string;
  signal?: AbortSignal;
}

export interface NanoCancelOptions {
  signal?: AbortSignal;
}

export interface NanoPollOptions {
  signal?: AbortSignal;
  intervalMs?: number;
}

const SETTLED_STATUSES: readonly NanoTaskStatus[] = [
  "succeeded",
  "failed",
  "canceled",
  "unknown",
];

function normalizeBase(base: string): string {
  return base.replace(/\/+$/, "");
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  let body: { success?: boolean; data?: T; error?: string; code?: string } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // leave body empty; a non-JSON 5xx becomes a generic HTTP error below
  }
  if (!response.ok || body.success !== true || body.data === undefined) {
    throw new NanoHttpError(
      body.error || `Nano request failed with status ${response.status}`,
      response.status,
      body.code || "HTTP_ERROR",
    );
  }
  return body.data;
}

interface RetryOptions {
  signal?: AbortSignal;
  maxAttempts?: number;
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) throw new NanoHttpError("Nano request aborted", 0, "ABORTED");
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: options.signal });
    } catch (error) {
      if (attempt === maxAttempts || options.signal?.aborted) {
        throw new NanoHttpError(
          error instanceof Error ? error.message : "Nano request failed",
          0,
          "NETWORK_ERROR",
        );
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(1000 * 2 ** attempt, 5000));
        options.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
      continue;
    }
    return parseEnvelope<T>(response);
  }
  throw new NanoHttpError("Nano request failed after retries", 0, "NETWORK_ERROR");
}

export interface UseNanoTaskApi {
  admit(
    payload: NanoAdmitPayload,
    options?: NanoAdmitOptions,
  ): Promise<{ taskId: string; status: NanoTaskStatus; created: boolean; cost: number }>;
  get(taskId: string, options?: NanoGetOptions): Promise<NanoTaskDto>;
  list(options?: NanoListOptions): Promise<NanoTaskListDto>;
  cancel(
    taskId: string,
    options?: NanoCancelOptions,
  ): Promise<{ taskId: string; status: NanoTaskStatus; refunded: boolean }>;
  poll(taskId: string, options?: NanoPollOptions): Promise<NanoTaskDto>;
}

export function useNanoTask(apiBase: string): UseNanoTaskApi {
  const baseRef = useRef(normalizeBase(apiBase));
  const base = baseRef.current;

  const admit = useCallback(
    async (payload: NanoAdmitPayload, options: NanoAdmitOptions = {}) =>
      fetchJson<{ taskId: string; status: NanoTaskStatus; created: boolean; cost: number }>(
        `${base}/tasks`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        options,
      ),
    [base],
  );

  const get = useCallback(
    async (taskId: string, options: NanoGetOptions = {}) =>
      fetchJson<NanoTaskDto>(`${base}/tasks/${encodeURIComponent(taskId)}`, {}, options),
    [base],
  );

  const list = useCallback(
    async (options: NanoListOptions = {}) => {
      const params = new URLSearchParams();
      params.set("pageSize", String(options.pageSize ?? 20));
      if (options.nextCursor) params.set("nextCursor", options.nextCursor);
      return fetchJson<NanoTaskListDto>(`${base}/tasks?${params.toString()}`, {}, options);
    },
    [base],
  );

  const cancel = useCallback(
    async (taskId: string, options: NanoCancelOptions = {}) =>
      fetchJson<{ taskId: string; status: NanoTaskStatus; refunded: boolean }>(
        `${base}/tasks/${encodeURIComponent(taskId)}/cancel`,
        { method: "POST" },
        options,
      ),
    [base],
  );

  const poll = useCallback(
    async (taskId: string, options: NanoPollOptions = {}): Promise<NanoTaskDto> => {
      const intervalMs = options.intervalMs ?? 1000;
      for (;;) {
        if (options.signal?.aborted) {
          throw new NanoHttpError("Nano poll aborted", 0, "ABORTED");
        }
        const task = await get(taskId, { signal: options.signal });
        if (SETTLED_STATUSES.includes(task.status)) return task;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, intervalMs);
          options.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        });
      }
    },
    [get],
  );

  return { admit, get, list, cancel, poll };
}

/** Convenience hook: polls one task and exposes its latest settled status. */
export function useNanoTaskStatus(taskId: string, apiBase: string): NanoTaskStatus | null {
  const [status, setStatus] = useState<NanoTaskStatus | null>(null);
  const api = useNanoTask(apiBase);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    api
      .poll(taskId, { signal: controller.signal })
      .then((task) => {
        if (!cancelled) setStatus(task.status);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [api, taskId]);
  return status;
}
