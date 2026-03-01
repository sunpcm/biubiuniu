"use client";

import { Button } from "@niu/ui/button";
import { Link as I18nLink } from "@/i18n/routing";
import { useTranslations } from "next-intl";

export default function NotFound() {
  const t = useTranslations("NotFound");

  return (
    <div className="flex min-h-screen w-full items-center justify-center">
      <div className="px-4 text-center sm:px-6 lg:px-8">
        <div className="mx-auto max-w-md">
          <div className="mb-4 text-6xl font-bold sm:text-8xl">404</div>

          <h1 className="mb-4 text-2xl font-bold sm:text-3xl">{t("title")}</h1>

          <p className="mb-8 text-base text-gray-600 sm:text-lg dark:text-gray-400">
            {t("description")}
          </p>

          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            <I18nLink href="/">
              <Button className="w-full sm:w-auto">{t("backToHome")}</Button>
            </I18nLink>

            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => window.history.back()}
            >
              {t("goBack")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
