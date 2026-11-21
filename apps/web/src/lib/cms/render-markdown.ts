import "server-only";

import { renderSanitizedMarkdown } from "./markdown";

export async function renderPostMarkdown(markdown: string): Promise<string> {
  return renderSanitizedMarkdown(markdown);
}
