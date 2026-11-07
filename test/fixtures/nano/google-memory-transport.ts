/**
 * Actual Google GenAI SDK 1.43.0 + local memory transport.
 *
 * `GoogleGenAI` (used by `createGoogleNanoProvider`) obtains `fetch` from
 * `globalThis.fetch`; the SDK's own error path documents polyfilling
 * `globalThis.fetch` as a supported injection point for tests. This fixture
 * installs an in-memory `fetch` that counts real HTTP-transport invocations and
 * returns a controlled SSE stream, so a paid dispatch can be proven to reach the
 * transport exactly once without any network access.
 *
 * This is NOT a port-level fake like `CountingNanoProvider`; the provider under
 * test is the real `@google/genai` client with `retryOptions.attempts = 1`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type {
  NanoProvider,
  NanoProviderRequest,
  NanoProviderResult,
} from "@sunpcm/niu-feature-nano";
import { createGoogleNanoProvider } from "@sunpcm/niu-feature-nano/provider/google";

/** A valid 1x1 PNG used as the generated image payload. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

export type GoogleMemoryTransportMode =
  | "success"
  | "lost-response"
  | "bad-stream"
  | "http-503";

export interface GoogleMemoryTransportProviderOptions {
  counterFile?: string;
  mode?: GoogleMemoryTransportMode;
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function streamResponse(body: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

export class GoogleMemoryTransportProvider implements NanoProvider {
  private readonly delegate: NanoProvider;
  private readonly counterFile: string | undefined;
  private readonly originalFetch: FetchLike | undefined;

  constructor(options: GoogleMemoryTransportProviderOptions = {}) {
    this.counterFile = options.counterFile;
    this.originalFetch = globalThis.fetch as FetchLike | undefined;
    const mode: GoogleMemoryTransportMode = options.mode ?? "success";
    const self = this;

    const fetchOverride: FetchLike = async (input, init) => {
      self.bump();
      void input;
      void init;
      if (mode === "lost-response") {
        throw new Error("simulated network failure");
      }
      if (mode === "http-503") {
        return new Response("service unavailable", { status: 503 });
      }
      if (mode === "bad-stream") {
        return streamResponse("data: {not json}\n\n");
      }
      return streamResponse(
        sseChunk({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: "image/png", data: PNG_BASE64 } }],
              },
            },
          ],
        }),
      );
    };

    globalThis.fetch = fetchOverride as typeof globalThis.fetch;
    this.delegate = createGoogleNanoProvider({
      apiKey: "memory-transport-fake-key",
      model: "gemini",
    });
  }

  private read(): number {
    if (!this.counterFile || !existsSync(this.counterFile)) return 0;
    const value = Number.parseInt(
      readFileSync(this.counterFile, "utf8").trim() || "0",
      10,
    );
    return Number.isFinite(value) ? value : 0;
  }

  private bump(): void {
    if (!this.counterFile) return;
    writeFileSync(this.counterFile, String(this.read() + 1));
  }

  generate(request: NanoProviderRequest): Promise<NanoProviderResult> {
    return this.delegate.generate(request);
  }

  /** Restore the process-global fetch for teardown. */
  restore(): void {
    if (this.originalFetch !== undefined) {
      globalThis.fetch = this.originalFetch as typeof globalThis.fetch;
    }
  }
}
