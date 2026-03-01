import { Button } from "@niu/ui/button";
import { Card } from "@niu/ui/card";
import { Link as I18nLink, Locale, routing } from "@/i18n/routing";
import { constructMetadata } from "@/lib/metadata";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

type Params = Promise<{ locale: string }>;

type MetadataProps = {
  params: Params;
};

export async function generateMetadata({ params }: MetadataProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "ErrorPage.403" });

  return constructMetadata({
    page: "403",
    title: t("title"),
    description: t("description"),
    locale: locale as Locale,
    path: `/403`,
    canonicalUrl: "/403",
  });
}

export default async function ForbiddenPage({ params }: { params: Params }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "ErrorPage.403" });

  return (
    <Card className="m-4 flex flex-col items-center justify-center md:m-12 lg:m-24">
      <div className="p-4 text-center md:p-8">
        <h1 className="mb-4 text-2xl font-bold text-red-600">{t("title")}</h1>
        <p className="mb-6">{t("description")}</p>
        <div className="flex flex-col justify-center gap-4 sm:flex-row">
          <Button asChild className="px-4 py-2">
            <I18nLink href={t("button.href")} title={t("button.name")}>
              {t("button.name")}
            </I18nLink>
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}
