import { isAiEnabled } from "@/config/features";
import { apiResponse } from "@/lib/api-response";

/**
 * Closed entry: paid AI image generation is disabled until the durable task
 * contract (plan §5.4) ships. No provider is called and no credits move.
 */
export async function POST() {
  if (!isAiEnabled()) {
    return apiResponse.error("AI generation is not available yet.", 503);
  }
  return apiResponse.error("AI generation is not available yet.", 503);
}
