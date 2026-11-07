export const DEFAULT_PRICING_PATH = "/#pricing";

export function resolvePricingPath(value = process.env.NEXT_PUBLIC_PRICING_PATH): string {
  const configuredPath = value?.trim();
  return configuredPath || DEFAULT_PRICING_PATH;
}

export const PRICING_PATH = resolvePricingPath();

export function applyPricingOverride<T extends { id?: string; href: string }>(link: T): T {
  return {
    ...link,
    href: link.id === "pricing" ? PRICING_PATH : link.href,
  };
}
