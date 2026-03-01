import { Button } from "@niu/ui/button";
import { Card } from "@niu/ui/card";
import { Link as I18nLink, Locale } from "@/i18n/routing";
import { constructMetadata } from "@/lib/metadata";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

type Params = Promise<{ locale: string }>;

type MetadataProps = {
  params: Params;
};

export async function generateMetadata({ params }: MetadataProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "ErrorPage.StripeError",
  });

  return constructMetadata({
    page: "Stripe Error",
    title: t("title"),
    description: t("description"),
    locale: locale as Locale,
    path: `/stripe-error`,
    canonicalUrl: "/stripe-error",
  });
}

export default async function StripeErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;

  const t = await getTranslations("ErrorPage.StripeError");

  return (
    <Card className="m-4 flex flex-col items-center justify-center md:m-12 lg:m-24">
      <div className="p-4 text-center md:p-8">
        <h1 className="mb-4 text-2xl font-bold text-red-600">{t("title")}</h1>
        <p className="mb-6">{message}</p>
        <div className="flex flex-col justify-center gap-4 sm:flex-row">
          <Button asChild className="px-4 py-2">
            <I18nLink href="/" title={t("goToHome")}>
              {t("goToHome")}
            </I18nLink>
          </Button>
          <Button asChild variant="outline" className="px-4 py-2">
            <I18nLink href="/dashboard" title={t("goToDashboard")}>
              {t("goToDashboard")}
            </I18nLink>
          </Button>
        </div>
      </div>
    </Card>
  );
}
