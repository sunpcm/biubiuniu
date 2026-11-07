import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type {
  NanoProvider,
  NanoProviderRequest,
  NanoProviderResult,
} from "@sunpcm/niu-feature-nano";

/**
 * A zero-network provider used only by the crash/restart fixtures. It implements
 * the real `NanoProvider` port and returns a valid PNG result, but records every
 * invocation to a counter file so the parent process can prove a paid dispatch
 * was sent exactly once (and never re-sent after a crash).
 */
export class CountingNanoProvider implements NanoProvider {
  private readonly counterFile: string | undefined;

  constructor(counterFile: string | undefined) {
    this.counterFile = counterFile;
  }

  private read(): number {
    if (!this.counterFile || !existsSync(this.counterFile)) return 0;
    const value = Number.parseInt(readFileSync(this.counterFile, "utf8").trim() || "0", 10);
    return Number.isFinite(value) ? value : 0;
  }

  private write(value: number): void {
    if (!this.counterFile) return;
    writeFileSync(this.counterFile, String(value));
  }

  async generate(_request: NanoProviderRequest): Promise<NanoProviderResult> {
    this.write(this.read() + 1);
    return {
      images: [
        {
          dataBase64:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          mimeType: "image/png",
        },
      ],
      text: null,
    };
  }
}
