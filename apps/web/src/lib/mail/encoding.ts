/**
 * [INPUT]: no external dependencies; pure utility functions
 * [OUTPUT]: exports bufferToBase64 and base64ToArrayBuffer (compatible with Node and Edge runtimes)
 * [POS]: lib/mail encoding utilities, consumed by resend and cloudflare providers for attachment handling
 * [PROTOCOL]: Update this header when changed, then check CLAUDE.md
 */

export function bufferToBase64(buf: ArrayBuffer): string {
  if (typeof Buffer !== "undefined") return Buffer.from(buf).toString("base64");
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(base64, "base64");
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
