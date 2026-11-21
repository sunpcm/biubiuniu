import { createNavigation } from 'next-intl/navigation';
import { defineRouting } from 'next-intl/routing';

export const LOCALES = ['en', 'zh', 'ja'] as const
export const DEFAULT_LOCALE = 'zh'

/** ja remains routable for legacy links, but is not offered as a UI language. */
export const SELECTABLE_LOCALES = ['en', 'zh'] as const
export const DISABLED_UI_LOCALES = ['ja'] as const

export const LOCALE_NAMES: Record<string, string> = {
  en: 'English',
  zh: '中文',
  ja: '日本語',
}
export const SHORT_LOCALE_NAMES: Record<string, string> = {
  en: 'EN',
  zh: '中',
  ja: '日',
}
export const LOCALE_TO_HREFLANG: Record<string, string> = {
  en: 'en-US',
  zh: 'zh-CN',
  ja: 'ja-JP',
}

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localeDetection: false,
  localePrefix: 'as-needed',
});

export const {
  Link,
  redirect,
  usePathname,
  useRouter,
  getPathname,
} = createNavigation(routing);


export type Locale = (typeof routing.locales)[number];

export function resolveLocaleFallbackPath(pathname: string): string {
  const match = /^\/ja(?:\/(.*))?$/.exec(pathname);
  if (!match) return pathname;
  return match[1] ? `/${match[1]}` : '/';
}

export function resolveLocaleFallbackUrl(
  pathname: string,
  search: string = '',
): string {
  return `${resolveLocaleFallbackPath(pathname)}${search}`;
}
