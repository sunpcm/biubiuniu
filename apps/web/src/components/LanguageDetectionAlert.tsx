"use client";

import { Button } from "@niu/ui/button";
import { Link as I18nLink, LOCALE_NAMES, routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { useLocaleStore } from "@/stores/localeStore";
import { ArrowRight, Globe, X } from "lucide-react";
import { useLocale } from "next-intl";
import { useCallback, useEffect, useState } from "react";

export function LanguageDetectionAlert() {
  const [countdown, setCountdown] = useState(10); // countdown 10s and dismiss
  const [isVisible, setIsVisible] = useState(false);
  const locale = useLocale();
  const [detectedLocale, setDetectedLocale] = useState<string | null>(null);
  const [alertMessages, setAlertMessages] = useState<any>(null);
  const { showLanguageAlert, setShowLanguageAlert, dismissLanguageAlert, getLangAlertDismissed } =
    useLocaleStore();

  const handleDismiss = useCallback(() => {
    setIsVisible(false);
    setTimeout(() => {
      dismissLanguageAlert();
    }, 300);
  }, [dismissLanguageAlert]);

  const handleSwitchLanguage = useCallback(() => {
    dismissLanguageAlert();
  }, [dismissLanguageAlert]);

  useEffect(() => {
    const detectedLang = navigator.language; // Get full language code, e.g., zh_HK
    const storedDismiss = getLangAlertDismissed();

    if (!storedDismiss) {
      let supportedLang = routing.locales.find((l) => l === detectedLang);

      if (!supportedLang) {
        const mainLang = detectedLang.split("-")[0];
        supportedLang = routing.locales.find((l) => l.startsWith(mainLang));
      }

      if (supportedLang && supportedLang !== locale) {
        setDetectedLocale(supportedLang);
        setShowLanguageAlert(true);
        setTimeout(() => setIsVisible(true), 100);
      }
    }
  }, [locale, getLangAlertDismissed, setShowLanguageAlert]);

  useEffect(() => {
    if (detectedLocale) {
      import(`@/i18n/messages/${detectedLocale}/common.json`).then((mod) => {
        setAlertMessages(mod.default?.LanguageDetection ?? mod.LanguageDetection);
      });
    }
  }, [detectedLocale]);

  useEffect(() => {
    let timer: NodeJS.Timeout;

    if (showLanguageAlert && countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [showLanguageAlert, countdown]);

  useEffect(() => {
    if (countdown === 0 && showLanguageAlert) {
      handleDismiss();
    }
  }, [countdown, showLanguageAlert, handleDismiss]);

  if (!showLanguageAlert || !detectedLocale || !alertMessages) return null;

  return (
    <div
      className={cn(
        "fixed top-16 right-0 z-50 mx-4 max-w-xs sm:right-4 sm:max-w-sm",
        "transform transition-all duration-300 ease-in-out",
        isVisible ? "translate-x-0 translate-y-0 opacity-100" : "translate-x-full opacity-0",
      )}
      role="banner"
      aria-live="polite"
      aria-label="Language detection alert"
    >
      <div className="bg-background/95 border-border relative rounded-xl border p-4 shadow-lg backdrop-blur-md">
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 h-6 w-6 opacity-50 hover:opacity-100"
          onClick={handleDismiss}
          aria-label="Dismiss language suggestion"
        >
          <X className="h-4 w-4" />
        </Button>

        <div className="pr-8">
          <div className="mb-3 flex items-center gap-2">
            <Globe className="text-primary h-4 w-4" />
            <h3 className="text-foreground text-sm font-medium">{alertMessages.title}</h3>
          </div>

          <p className="text-muted-foreground mb-4 text-xs leading-relaxed">
            {alertMessages.description}
          </p>

          <div className="flex items-center justify-between">
            <Button asChild onClick={handleSwitchLanguage}>
              <I18nLink
                href="/"
                title={`${alertMessages.switchTo} ${LOCALE_NAMES[detectedLocale]}`}
                locale={detectedLocale as any}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2",
                  "bg-primary text-primary-foreground hover:bg-primary/90",
                  "text-sm font-medium transition-colors",
                  "group focus:ring-primary/50 focus:ring-2 focus:outline-hidden",
                )}
                aria-label={`${alertMessages.switchTo} ${LOCALE_NAMES[detectedLocale]}`}
              >
                <span>
                  {alertMessages.switchTo} {LOCALE_NAMES[detectedLocale]}
                </span>
                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
              </I18nLink>
            </Button>

            <span className="text-muted-foreground text-xs">{countdown}s</span>
          </div>
        </div>

        <div className="from-primary/10 pointer-events-none absolute inset-0 rounded-xl bg-linear-to-r to-transparent opacity-50" />
      </div>
    </div>
  );
}
