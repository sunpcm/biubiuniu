import { DeviceSignalCollector } from "@/components/auth/DeviceSignalCollector";
import { GoogleOneTap } from "@/components/auth/GoogleOneTap";
import { ImpersonationBanner } from "@/components/auth/ImpersonationBanner";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { FeedbackFab } from "@/components/feedback/FeedbackFab";
import { FeedbackProvider } from "@/components/feedback/FeedbackProvider";
import { LanguageDetectionAlert } from "@/components/LanguageDetectionAlert";
import ConsentBanner from "@/components/shared/CookieConsent/ConsentBanner";
import ConsentGate from "@/components/shared/CookieConsent/ConsentGate";
import CrispChat from "@/components/support/CrispChat";
import { TailwindIndicator } from "@/components/TailwindIndicator";
import GoogleAdsense from "@/components/tracking/GoogleAdsense";
import GoogleAnalytics from "@/components/tracking/GoogleAnalytics";
import MicrosoftClarity from "@/components/tracking/MicrosoftClarity";
import PlausibleAnalytics from "@/components/tracking/PlausibleAnalytics";
import PostHogPageView from "@/components/tracking/PostHogPageView";
import PostHogProvider from "@/components/tracking/PostHogProvider";
import RybbitScript from "@/components/tracking/RybbitScript";
import ToltScript from "@/components/tracking/ToltScript";
import UmamiScript from "@/components/tracking/UmamiScript";
import { UserSourceDeviceSync } from "@/components/tracking/UserSourceDeviceSync";
import ServiceWorkerRegister from "@/components/pwa/ServiceWorkerRegister";
import { pacifico } from "@/app/fonts";
import { DomTranslationGuard } from "@/components/shared/DomTranslationGuard";
import { Toaster } from "@/components/ui/sonner";
import { siteConfig } from "@/config/site";
import { DEFAULT_LOCALE, Locale, routing } from "@/i18n/routing";
import { constructMetadata } from "@/lib/metadata";
import { cn } from "@/lib/utils";
import "@/styles/globals.css";
import "@/styles/loading.css";
import { Analytics } from "@vercel/analytics/react";
import { Metadata, Viewport } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import {
  getMessages,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";
import { ThemeProvider } from "next-themes";
import { Inter as FontSans } from "next/font/google";
import { notFound } from "next/navigation";

const fontSans = FontSans({
  subsets: ["latin"],
  variable: "--font-sans",
});

type MetadataProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: MetadataProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Home" });

  return constructMetadata({
    title: t("title"),
    description: t("description"),
    locale: locale as Locale,
    path: `/`,
  });
}

export const viewport: Viewport = {
  themeColor: siteConfig.themeColors,
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const COOKIE_CONSENT_ENABLED =
    process.env.NEXT_PUBLIC_COOKIE_CONSENT_ENABLED === "true";

  // Ensure that the incoming `locale` is valid
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const messages = await getMessages();

  return (
    // translate="no": whole-page browser translation mutates the text nodes
    // React manages, causing removeChild/insertBefore crashes
    // (facebook/react#11538) — disabled site-wide
    <html
      lang={locale || DEFAULT_LOCALE}
      translate="no"
      suppressHydrationWarning
    >
      <head>
        <DomTranslationGuard />
        <meta name="google" content="notranslate" />
        <ToltScript />
      </head>
      <body
        className={cn(
          "min-h-screen bg-background flex flex-col",
          fontSans.variable,
          pacifico.variable
        )}
      >
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme={siteConfig.defaultNextTheme}
            enableSystem
          >
            <PostHogProvider>
              <FeedbackProvider>
                {messages.LanguageDetection && <LanguageDetectionAlert />}

                {children}
                <FeedbackFab />
                <FeedbackDialog />
                {/* Always-on notice for a borrowed session: once a superadmin
                    impersonates from admin/users, "Viewing as …" and the way
                    back follow them across the site; renders null otherwise.
                    Mounted inside the i18n provider — it uses useLocale to
                    build the return hop's locale prefix. */}
                <ImpersonationBanner />
              </FeedbackProvider>
            </PostHogProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
        <GoogleOneTap />
        {/* Client touch point of the signup-gift gate: mounted in the root
            layout so One Tap, the login page and the login dialog all pass
            through it and the device-fingerprint cookie reaches the server
            with the signup request (see lib/signup-gift-gate). Renders no DOM */}
        <DeviceSignalCollector />
        {/* Signup attribution, browser half: the source block is written by
            proxy.ts (lib/tracking/capture), this only tops up the device block
            the browser alone knows. Renders no DOM */}
        <UserSourceDeviceSync />
        <ServiceWorkerRegister />
        <CrispChat />
        <Toaster richColors />
        <TailwindIndicator />
        <>
          {COOKIE_CONSENT_ENABLED ? (
            <>
              {process.env.NODE_ENV === "development" ? null : (
                <>
                  {process.env.VERCEL_ENV ? <Analytics /> : <></>}
                  <PlausibleAnalytics />
                  <RybbitScript />
                  <UmamiScript />
                  <ConsentGate>
                    <GoogleAnalytics />
                    <GoogleAdsense />
                    <MicrosoftClarity />
                    <PostHogPageView />
                  </ConsentGate>
                </>
              )}
              <ConsentBanner />
            </>
          ) : (
            <>
              {process.env.NODE_ENV === "development" ? null : (
                <>
                  {process.env.VERCEL_ENV ? <Analytics /> : <></>}
                  <PlausibleAnalytics />
                  <GoogleAnalytics />
                  <GoogleAdsense />
                  <MicrosoftClarity />
                  <RybbitScript />
                  <UmamiScript />
                  <PostHogPageView />
                </>
              )}
            </>
          )}
        </>
      </body>
    </html>
  );
}
