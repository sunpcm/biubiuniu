/**
 * [INPUT]: Depends on the slugify package and the NEXT_PUBLIC_SITE_URL env var
 * [OUTPUT]: Exports sanitizeNextPath, getURL, getDomain, validateUrl,
 *           slugifyHostname, universalSlugify, getDataFromDataUrl
 * [POS]: The URL toolbox of lib; sanitizeNextPath is the single sanitizing
 *        channel for the login ?next= hop, shared by LoginForm and LoginDialog —
 *        it lives here rather than inside either consumer because one rule kept
 *        in two places eventually drifts apart
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import slugify from "slugify";

/* ── Login redirect sanitizing ─────────────────────────────────── */
// Accept in-app relative paths only ("/x", never "//x" nor an absolute URL).
// ?next= comes from the query string; feeding it straight to new URL() or
// redirect() lets an absolute URL hijack the hop into an open redirect.
export function sanitizeNextPath(next: string | null | undefined): string | null {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

export function getURL(path: string = '') {
  let url =
    process.env.NEXT_PUBLIC_SITE_URL ??
    'http://localhost:3000';
  url = url.startsWith('http') ? url : `https://${url}`;
  url = url.charAt(url.length - 1) === '/' ? url : `${url}/`;
  // Tolerate a leading slash — i18n helpers like getPathname emit "/zh/x"
  // shaped paths, so callers never need slash-stripping gymnastics.
  url = `${url}${path.replace(/^\//, '')}`;
  return url;
}

export function getDomain(url: string) {
  try {
    const urlWithProtocol = url.startsWith('http') ? url : `https://${url}`;
    const domain = new URL(urlWithProtocol).hostname;
    return domain.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export async function validateUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(10000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function slugifyHostname(hostname: string) {
  let slug = hostname.toLowerCase().replace(/\./g, '-');
  slug = slug.replace(/[^a-z0-9-]/g, '');

  return slug;
}

export function universalSlugify(name: string) {
  if (!name) {
    return '';
  }

  const preparedText = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const slug = slugify(preparedText, {
    replacement: '-',
    remove: /[*+~.()'"!:@]/g,
    lower: true,
    strict: true,
    trim: true
  });

  return slug;
}

export const getDataFromDataUrl = (dataUrl: string): { buffer: Buffer; contentType: string } | null => {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);

  if (!match) {
    console.error("Invalid data URL format");
    return null;
  }
  const contentType = match[1];
  const base64Data = match[2];
  const buffer = Buffer.from(base64Data, 'base64');
  return { buffer, contentType };
}
