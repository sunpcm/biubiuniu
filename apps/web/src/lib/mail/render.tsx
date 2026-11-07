/**
 * [INPUT]: depends on React's ReactElement and dynamic import of react-dom/server's renderToStaticMarkup
 * [OUTPUT]: exports renderEmailToHtml (React -> HTML) and htmlToPlainText (HTML -> plain text)
 * [POS]: lib/mail rendering utilities, consumed by index.ts resolveBody and provider text fallbacks
 * [PROTOCOL]: Update this header when changed, then check CLAUDE.md
 */

import * as React from "react";

export async function renderEmailToHtml(element: React.ReactElement): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const htmlBody = renderToStaticMarkup(element);
  const doctype =
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';
  return `${doctype}${htmlBody.replace(/<!DOCTYPE.*?>/i, "")}`;
}

/** Simple HTML-to-plain-text conversion for scenarios that benefit from sending both html and text versions. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
