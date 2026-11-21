import type {
  NanoTask,
  NanoTaskStatus,
  NanoProviderResult,
} from "@sunpcm/niu-feature-nano";

export interface NanoInlineImage {
  kind: "inline";
  mimeType: string;
  dataBase64: string;
}

export interface NanoObjectImage {
  kind: "object";
  url: string;
}

export type NanoPublicResultImage = NanoInlineImage | NanoObjectImage;

export interface NanoPublicResult {
  images: NanoPublicResultImage[];
  text: string | null;
}

export interface NanoPublicTask {
  taskId: string;
  status: NanoTaskStatus;
  cost: number;
  result: NanoPublicResult | null;
  createdAt: string;
  updatedAt: string;
}

export interface NanoPublicTaskListItem {
  taskId: string;
  status: NanoTaskStatus;
  cost: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Internal persisted result reference. The dispatch worker writes the generated
 * inline images + text here. Object-backed storage is not part of this card's
 * write set; when a storage owner later persists large outputs off-row, the
 * reference can carry an object id that this mapper projects to the authorized
 * same-origin `GET /api/nano/tasks/:taskId/result/:index` URL.
 */
export interface NanoResultRef {
  images: Array<{ mimeType: string; dataBase64: string }>;
  text: string | null;
}

export function parseResultRef(resultRef: string): NanoResultRef | null {
  try {
    const parsed = JSON.parse(resultRef) as Partial<NanoResultRef>;
    if (!parsed || !Array.isArray(parsed.images)) return null;
    return {
      images: parsed.images
        .filter(
          (img): img is { mimeType: string; dataBase64: string } =>
            typeof img?.mimeType === "string" &&
            typeof img?.dataBase64 === "string",
        ),
      text: typeof parsed.text === "string" ? parsed.text : null,
    };
  } catch {
    return null;
  }
}

/**
 * Persist a provider result as the inline `resultRef` payload consumed by
 * `parseResultRef`/`toPublicResult`. The dispatch sweeper owns this mapping so
 * the result DTO always carries MIME-typed images.
 */
export function serializeProviderResult(result: NanoProviderResult): {
  resultRef: string;
  resultSummary: string;
} {
  const ref: NanoResultRef = {
    images: result.images.map((image) => ({
      mimeType: image.mimeType,
      dataBase64: image.dataBase64,
    })),
    text: result.text,
  };
  return {
    resultRef: JSON.stringify(ref),
    resultSummary: `${ref.images.length} image(s)`,
  };
}

export function toPublicResult(resultRef: string): NanoPublicResult | null {
  const ref = parseResultRef(resultRef);
  if (!ref) return null;
  return {
    images: ref.images.map((image) => ({
      kind: "inline" as const,
      mimeType: image.mimeType,
      dataBase64: image.dataBase64,
    })),
    text: ref.text,
  };
}

export function toPublicTask(task: NanoTask): NanoPublicTask {
  return {
    taskId: task.id,
    status: task.status,
    cost: task.cost,
    result:
      task.status === "succeeded" && task.resultRef
        ? toPublicResult(task.resultRef)
        : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export function toPublicTaskListItem(task: NanoTask): NanoPublicTaskListItem {
  return {
    taskId: task.id,
    status: task.status,
    cost: task.cost,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

interface ListCursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(value: string): ListCursor | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const { createdAt: createdAtValue, id } = parsed as Record<string, unknown>;
    if (
      typeof createdAtValue !== "string" ||
      typeof id !== "string" ||
      id.length === 0
    ) {
      return null;
    }
    const createdAt = new Date(createdAtValue);
    if (
      Number.isNaN(createdAt.getTime()) ||
      createdAt.toISOString() !== createdAtValue
    ) {
      return null;
    }
    return { createdAt, id };
  } catch {
    return null;
  }
}
