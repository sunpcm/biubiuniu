import { GlowingEffect } from "@niu/ui/glowing-effect";
import { RainbowButton } from "@niu/ui/rainbow-button";
import { Link as I18nLink } from "@/i18n/routing";
import { MousePointerClick } from "lucide-react";
import { useTranslations } from "next-intl";

export default function CTA() {
  const t = useTranslations("Landing.CTA");

  return (
    <section id="cta" className="py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="relative">
          <div className="absolute inset-0 rounded-3xl bg-linear-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 blur-3xl"></div>

          <div className="border-border relative rounded-3xl border-[0.75px] p-3">
            <GlowingEffect
              spread={60}
              glow={true}
              disabled={false}
              proximity={80}
              inactiveZone={0.01}
              borderWidth={2}
            />
            <div className="from-background via-background to-muted/20 relative overflow-hidden rounded-2xl border-[0.75px] bg-linear-to-br p-12 text-center shadow-lg md:p-16 dark:shadow-[0px_0px_40px_0px_rgba(45,45,45,0.4)]">
              <div className="absolute top-0 left-0 h-full w-full opacity-30">
                <div className="absolute top-8 left-8 h-2 w-2 rounded-full bg-linear-to-r from-indigo-500 to-purple-500"></div>
                <div className="absolute top-16 right-12 h-1 w-1 rounded-full bg-linear-to-r from-purple-500 to-pink-500"></div>
                <div className="absolute bottom-12 left-16 h-1.5 w-1.5 rounded-full bg-linear-to-r from-pink-500 to-indigo-500"></div>
                <div className="absolute right-8 bottom-8 h-2 w-2 rounded-full bg-linear-to-r from-indigo-500 to-purple-500"></div>
              </div>

              <h2 className="z-10 mb-4 text-center font-sans text-lg font-semibold md:text-5xl">
                <span className="text-primary">{t("title")}</span>
              </h2>

              <p className="text-muted-foreground mx-auto mb-10 max-w-3xl text-lg leading-relaxed md:text-xl">
                {t("description")}
              </p>

              <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                <I18nLink href="/#pricing" className="flex items-center gap-2" prefetch={true}>
                  <RainbowButton>
                    <MousePointerClick className="h-5 w-5" />
                    {t("button")}
                  </RainbowButton>
                </I18nLink>
              </div>

              <div className="border-border/50 mt-10 border-t pt-8">
                <p className="text-muted-foreground mb-4 text-sm">{t("trustText")}</p>
                <div className="flex flex-wrap items-center justify-center gap-4 opacity-60">
                  <div className="text-xs font-medium">{t("features.deploy")}</div>
                  <div className="text-xs font-medium">{t("features.production")}</div>
                  <div className="text-xs font-medium">{t("features.updates")}</div>
                  <div className="text-xs font-medium">{t("features.i18n")}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
