import { DEFAULT_CURRENCY } from "@/config/common";
import { formatCurrency as formatCurrencyValue } from "@sunpcm/niu-utils";

export { cn } from "@sunpcm/niu-ui/cn";
export { formatBytes, kebabToPascalCase } from "@sunpcm/niu-utils";

export const formatCurrency = (
  amount: number | null | undefined,
  currency: string | null | undefined,
): string => formatCurrencyValue(amount, currency, DEFAULT_CURRENCY);
