// [CUSTOM: START] - Nano Banana AI feature page
import { Locale } from "@/i18n/routing";
import { constructMetadata } from "@/lib/metadata";
import { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import GeminiImageGenerator from "@/components/nano/GeminiImageGenerator";

type Params = Promise<{ locale: string }>;

type MetadataProps = {
  params: Params;
};

export async function generateMetadata({ params }: MetadataProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "Nano",
  });

  return constructMetadata({
    page: "Nano",
    title: t("title"),
    description: t("metaDescription"),
    locale: locale as Locale,
    path: `/nano`,
  });
}

export default function NanoPage() {
  const t = useTranslations("Nano");

  return (
    <div className="container mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-16 text-center">
        <h1 className="highlight-text mb-4 text-4xl font-bold md:text-5xl">{t("title")}</h1>
        <p className="text-muted-foreground mx-auto max-w-3xl text-lg">{t("description")}</p>
      </div>

      <GeminiImageGenerator />
    </div>
  );
}
// [CUSTOM: END]
