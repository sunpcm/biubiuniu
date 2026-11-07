"use client";

/**
 * Nano result URLs are either data: bytes, temporary blob: previews, or a
 * server-authorized same-origin result URL. They are runtime generated and
 * must not be passed through Next's remote image optimizer.
 */
export function NanoImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return <img src={src} alt={alt} className={className} />;
}
