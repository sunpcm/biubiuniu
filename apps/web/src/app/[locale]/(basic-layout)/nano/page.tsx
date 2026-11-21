import {
  generateNanoMetadata,
  NanoStudioPage,
} from "@/components/nano/NanoStudioPage";
import { Locale } from "@/i18n/routing";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

type Params = Promise<{ locale: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { locale } = await params;
  return generateNanoMetadata(locale as Locale);
}

export default async function NanoPage() {
  return (
    <div className="container mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <NanoStudioHeader />
      <NanoStudioPage />
    </div>
  );
}

async function NanoStudioHeader() {
  const t = await getTranslations("Landing.Nano");
  return (
    <div className="mb-10 text-center">
      <h1 className="mb-4 text-4xl font-bold md:text-5xl">{t("title")}</h1>
      <p className="text-muted-foreground mx-auto max-w-3xl text-lg">
        {t("description")}
      </p>
    </div>
  );
}
