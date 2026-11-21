/**
 * Provider port. Concrete providers (e.g. Google) live in explicit subpaths and
 * implement this; the core only sees the port, never a provider SDK.
 */
export interface NanoProviderRequest {
  prompt: string;
  /** Base64 image bytes, or null for text-only cases. */
  imageData: string | null;
  mimeType: string | null;
  model: string;
}

export interface NanoProviderResult {
  /** Generated images with their MIME types preserved. */
  images: Array<{ dataBase64: string; mimeType: string }>;
  text: string | null;
}

export interface NanoProvider {
  generate(request: NanoProviderRequest): Promise<NanoProviderResult>;
}

/**
 * Sanitized provider failure. Concrete providers never surface raw SDK errors,
 * messages, stacks, or input bytes. `unknown=true` means the remote may have
 * accepted the request but the local result/response was lost, so the dispatch
 * owner must not blindly refund or re-submit; it leaves the task for recovery.
 */
export class NanoProviderError extends Error {
  readonly unknown: boolean;
  constructor(message: string, options: { unknown?: boolean } = {}) {
    super(message);
    this.name = "NanoProviderError";
    this.unknown = options.unknown ?? false;
  }
}
