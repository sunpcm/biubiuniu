"use client";

import { useNanoConfig } from "@/components/nano/NanoConfigContext";
import { Button } from "@/components/ui/button";
import { RainbowButton } from "@/components/ui/rainbow-button";
import { siteConfig } from "@/config/site";
import { Link as I18nLink } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { SiDiscord } from "react-icons/si";

export default function Hero1() {
  const t = useTranslations("Landing.Hero");
  const { enabled: nanoEnabled } = useNanoConfig();

  return (
    <section className="w-full">
      <div className="container mx-auto">
        <div className="flex flex-col items-center justify-center gap-8 py-16 lg:py-24 2xl:py-40">
          <div className="flex max-w-3xl flex-col gap-4">
            <h1 className="z-10 text-center font-sans text-lg font-bold md:text-7xl">
              <span className="bg-linear-to-b bg-clip-text from-foreground to-muted-foreground text-transparent">
                {t("title")}
              </span>
            </h1>
            <p className="text-center text-lg leading-relaxed tracking-tight text-muted-foreground md:text-xl">
              {t("description")}
            </p>
          </div>
          <div className="flex flex-row flex-wrap items-center justify-center gap-2">
            {nanoEnabled ? (
              <I18nLink href="/nano" className="flex items-center gap-2">
                <RainbowButton>{t("nanoBananaButton")}</RainbowButton>
              </I18nLink>
            ) : (
              <I18nLink href="/nano" className="flex items-center gap-2">
                <RainbowButton>{t("nanoHistoryButton")}</RainbowButton>
              </I18nLink>
            )}
            <Button
              className="h-11 rounded-xl border-2 border-indigo-500 bg-white px-8 py-2 text-indigo-500 hover:text-indigo-600"
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
                {t("discordButton")}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
