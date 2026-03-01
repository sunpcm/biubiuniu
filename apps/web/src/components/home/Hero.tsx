import FeatureBadge from "@/components/shared/FeatureBadge";
import { Button } from "@niu/ui/button";
import { siteConfig } from "@/config/site";
import { Link as I18nLink } from "@/i18n/routing";
import { MousePointerClick } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { SiDiscord } from "react-icons/si";

export default function Hero() {
  const t = useTranslations("Landing.Hero");

  return (
    <div className="w-full">
      <div className="container mx-auto">
        <div className="flex flex-col items-center justify-center gap-8 py-16 lg:py-24 2xl:py-40">
          <FeatureBadge label={t("badge.label")} text={t("badge.text")} href={t("badge.href")} />
          <div className="flex max-w-3xl flex-col gap-4">
            <h1 className="z-10 text-center font-sans text-lg font-bold md:text-7xl">
              <span className="title-gradient">{t("title")}</span>
            </h1>

            <p className="text-muted-foreground text-center text-lg leading-relaxed tracking-tight md:text-xl">
              {t("description")}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              asChild
              className="border-primary h-11 rounded-xl border-2 px-8 py-2 text-white"
            >
              <I18nLink href={t("getStartedLink") || "#"} className="flex items-center gap-2">
                <MousePointerClick className="h-4 w-4" />
                {t("getStarted")}
              </I18nLink>
            </Button>
            <Button
              className="hover:bg-background h-11 rounded-xl border-2 bg-white px-8 py-2 text-indigo-500 hover:text-indigo-600"
              variant="outline"
              asChild
            >
              <Link
                href={siteConfig.socialLinks?.discord || "https://discord.gg/4sSVt8b2"}
                target="_blank"
                rel="noopener noreferrer nofollow"
                title="Join Discord"
                prefetch={false}
                className="flex items-center gap-2"
              >
                <SiDiscord className="h-4 w-4 text-indigo-500" />
                Join Discord
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
