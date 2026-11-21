/**
 * Google GenAI provider (SDK 1.43.0).
 *
 * This is the only subpath that imports `@google/genai`. It keeps the SDK on a
 * single business-level attempt (the SDK default when `retryOptions` is absent)
 * so a request is never silently re-sent. It never injects an unsupported
 * `fetch` option and never surfaces raw SDK errors/messages/stacks or input
 * bytes.
 *
 * Failure classification is conservative: a numeric 4xx status/code is a
 * determinate client rejection (`unknown:false`); anything else (5xx, network
 * error, timeout, lost response) is `unknown:true` so the dispatch owner does
 * not blindly refund or re-send. A stream that already delivered content and
 * then failed is also kept `unknown:true`, because part of the request may have
 * been accepted.
 */
import { GoogleGenAI } from "@google/genai";
import {
  NanoProviderError,
  type NanoProvider,
  type NanoProviderRequest,
  type NanoProviderResult,
} from "../provider.js";

export interface GoogleNanoProviderOptions {
  apiKey: string;
  model?: string;
  /** Per-request HTTP timeout, passed to the SDK 1.43.0 `httpOptions.timeout`. */
  timeoutMs?: number;
}

const DEFAULT_MODEL = "gemini-2.5-flash-image-preview";

interface StreamChunk {
  text?: string;
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
  }>;
}

function readNumericStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as { status?: unknown; code?: unknown };
  for (const raw of [candidate.status, candidate.code]) {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim() !== "") {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function classifyProviderError(error: unknown): NanoProviderError {
  const status = readNumericStatus(error);
  if (status !== null && status >= 400 && status < 500) {
    return new NanoProviderError("Nano provider rejected the request", { unknown: false });
  }
  return new NanoProviderError("Nano provider request outcome is unknown", { unknown: true });
}

export class GoogleNanoProvider implements NanoProvider {
  private readonly genAI: GoogleGenAI;
  private readonly model: string;

  constructor(options: GoogleNanoProviderOptions) {
    if (!options.apiKey) {
      throw new NanoProviderError("Google Nano provider requires an API key");
    }
    this.model = options.model || DEFAULT_MODEL;
    // Omit `retryOptions` on purpose: the SDK 1.43.0 default is already a single
    // attempt with no auto-retry, while the `p-retry` path it enables rewrites
    // HTTP failures into status-less `Error`s (e.g. "Non-retryable exception ..."
    // / "Retryable HTTP Error: ..."). A plain `fetch` keeps the numeric status on
    // the thrown `ApiError`, which is required to tell a determinate 4xx
    // rejection apart from an uncertain 5xx/stream failure.
    const httpOptions: Record<string, unknown> = {};
    if (options.timeoutMs !== undefined) {
      httpOptions.timeout = options.timeoutMs;
    }
    this.genAI = new GoogleGenAI({
      apiKey: options.apiKey,
      httpOptions,
    });
  }

  async generate(request: NanoProviderRequest): Promise<NanoProviderResult> {
    const parts: Array<Record<string, unknown>> = [];
    if (request.imageData && request.mimeType) {
      parts.push({ inlineData: { data: request.imageData, mimeType: request.mimeType } });
    }
    parts.push({ text: request.prompt });

    const contents = [{ role: "user", parts }];

    let stream: AsyncIterable<StreamChunk>;
    try {
      stream = (await this.genAI.models.generateContentStream({
        model: request.model || this.model,
        config: { responseModalities: ["IMAGE", "TEXT"] },
        contents,
      } as never)) as AsyncIterable<StreamChunk>;
    } catch (error) {
      throw classifyProviderError(error);
    }

    const images: Array<{ dataBase64: string; mimeType: string }> = [];
    let text = "";
    let consumed = false;
    try {
      for await (const chunk of stream) {
        consumed = true;
        if (chunk.text) text += chunk.text;
        for (const candidate of chunk.candidates ?? []) {
          for (const part of candidate.content?.parts ?? []) {
            if (part.inlineData?.data && part.inlineData.mimeType?.includes("image")) {
              images.push({
                dataBase64: part.inlineData.data,
                mimeType: part.inlineData.mimeType,
              });
            }
          }
        }
      }
    } catch (error) {
      if (consumed) {
        // Part of the stream was already delivered, so the remote may have
        // accepted and consumed the request. Never refund or re-send here.
        throw new NanoProviderError("Nano provider stream failed", { unknown: true });
      }
      throw classifyProviderError(error);
    }

    if (images.length === 0) {
      throw new NanoProviderError("Nano provider produced no images", { unknown: false });
    }
    return { images, text: text || null };
  }
}

export function createGoogleNanoProvider(options: GoogleNanoProviderOptions): NanoProvider {
  return new GoogleNanoProvider(options);
}
