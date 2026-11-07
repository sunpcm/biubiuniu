/**
 * Product-injected case allowlist.
 *
 * The shared package does not own product case content. The app supplies a
 * stable id set; the catalog only answers membership, which the API uses to
 * reject unknown case ids before recording a selection.
 */
import type { NanoCaseCatalog } from "./core.js";

export function createCaseCatalog(ids: readonly string[]): NanoCaseCatalog {
  const set = new Set(ids);
  return {
    has(caseId) {
      return set.has(caseId);
    },
    ids() {
      return [...set];
    },
  };
}
