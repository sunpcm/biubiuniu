/**
 * [INPUT]: No external dependencies — only the platform's built-in Intl API
 * [OUTPUT]: Exports formatNumber / formatDate / formatCurrency / formatCents
 * [POS]: The locale-aware formatting source of truth in lib — the single
 *        channel for displaying numbers/dates/money, shared by server and
 *        client; formatters are cached and reused per locale+options
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

// ────────────────────────────────────────────────────────────────
//  Formatter cache — Intl constructors are expensive (they load locale
//  data), while this app's option combinations are a finite static set of
//  literals; cached by locale+options, call sites need no useMemo and the
//  render path pays zero construction cost.
// ────────────────────────────────────────────────────────────────

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function cacheKey(locale: string, options?: object): string {
  return options ? `${locale}|${JSON.stringify(options)}` : locale;
}

function getNumberFormat(
  locale: string,
  options?: Intl.NumberFormatOptions
): Intl.NumberFormat {
  const key = cacheKey(locale, options);
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, options);
    numberFormats.set(key, format);
  }
  return format;
}

function getDateFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const key = cacheKey(locale, options);
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    dateFormats.set(key, format);
  }
  return format;
}

// ────────────────────────────────────────────────────────────────
//  Number
// ────────────────────────────────────────────────────────────────

/** Locale-aware number formatting; pass { signDisplay: "always" } for signed display */
export function formatNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions
): string {
  return getNumberFormat(locale, options).format(value);
}

// ────────────────────────────────────────────────────────────────
//  Date — defaults to dateStyle: "medium"; passing options replaces the default entirely
// ────────────────────────────────────────────────────────────────

export function formatDate(
  value: Date | number | string,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }
): string {
  return getDateFormat(locale, options).format(new Date(value));
}

// ────────────────────────────────────────────────────────────────
//  Money — backend amounts are always integer cents (Stripe's native
//  unit); formatCents is the standard entry point for order/billing
//  display, while formatCurrency takes a decimal amount for cases such as
//  pricing that are already denominated in major units. Currency codes are
//  upper-cased; an invalid code degrades to "12.34 USD" instead of throwing.
// ────────────────────────────────────────────────────────────────

export function formatCurrency(
  amount: number,
  currency: string,
  locale: string,
  options?: Intl.NumberFormatOptions
): string {
  const code = currency.toUpperCase();
  try {
    return getNumberFormat(locale, {
      style: "currency",
      currency: code,
      ...options,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

export function formatCents(
  cents: number,
  currency: string,
  locale: string
): string {
  return formatCurrency(cents / 100, currency, locale);
}
