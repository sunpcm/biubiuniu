export function kebabToPascalCase(str: string): string {
  if (!str) return str;
  return str
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

export const formatCurrency = (
  amount: number | null | undefined,
  currency: string | null | undefined,
  defaultCurrency = "usd",
): string => {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return "-";
  }
  const effectiveCurrency = (currency || defaultCurrency).toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: effectiveCurrency,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${effectiveCurrency}`;
  }
};

export function formatBytes(bytes: number, decimals = 2): string {
  if (!Number.isFinite(bytes) || bytes === 0) return "0 Bytes";

  const k = 1024;
  const dm = Math.trunc(Number.isFinite(decimals) ? decimals : 2);
  const clampedDecimals = Math.min(Math.max(dm, 0), 100);
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  const i = Math.min(
    Math.max(Math.floor(Math.log(Math.abs(bytes)) / Math.log(k)), 0),
    sizes.length - 1,
  );

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(clampedDecimals))} ${sizes[i]}`;
}

export function formatValue(
  value: number | string,
  unit: "count" | "revenue",
): string {
  if (unit === "revenue") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Number(value));
  }
  if (typeof value === "string") return value;
  return value.toLocaleString("en-US");
}
