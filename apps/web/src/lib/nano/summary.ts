import { createHash } from "node:crypto";

/**
 * Deterministic idempotency digest for an admit request. `caseId` participates
 * so the same requestKey with a different selected case is a content conflict,
 * not a silent replay of the prior prompt.
 */
export function nanoContentSummary(input: {
  prompt: string;
  image: string;
  mimeType: string;
  caseId?: string | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        prompt: input.prompt.trim(),
        image: input.image,
        mimeType: input.mimeType,
        caseId: input.caseId ?? null,
      }),
    )
    .digest("hex");
}
