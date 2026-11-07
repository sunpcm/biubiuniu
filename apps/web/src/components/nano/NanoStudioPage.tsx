import { getNanoPublicConfig } from "@/config/nano";
import { isNanoEnabled } from "@/config/features";
import { NanoStudio } from "./NanoStudio";
import { Locale, SELECTABLE_LOCALES } from "@/i18n/routing";
import { constructMetadata } from "@/lib/metadata";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateNanoMetadata(
  locale: Locale,
): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "Landing.Nano" });
  return constructMetadata({
    title: t("title"),
    description: t("metaDescription"),
    locale,
    path: "/nano",
    availableLocales: [...SELECTABLE_LOCALES],
  });
}

/**
 * Server page assembly. Keeping the public DTO resolution here means the
 * client never imports `config/features` or `config/nano`.
 */
export function NanoStudioPage() {
  return <NanoStudio config={getNanoPublicConfig(isNanoEnabled())} />;
}
