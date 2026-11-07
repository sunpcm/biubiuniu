import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing, type Locale } from "./routing";

export function requireValidatedLocale(locale: string): Locale {
  if (!hasLocale(routing.locales, locale)) notFound();
  return locale;
}
