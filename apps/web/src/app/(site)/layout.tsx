import { DomTranslationGuard } from "@/components/shared/DomTranslationGuard";
import { siteConfig } from "@/config/site";
import "@/styles/globals.css";
import { Viewport } from "next";

export const viewport: Viewport = {
  themeColor: siteConfig.themeColors,
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    // translate="no": disables whole-page browser translation, preventing React
    // DOM crashes (same as [locale]/layout)
    <html lang="en" translate="no">
      <head>
        <DomTranslationGuard />
        <meta name="google" content="notranslate" />
      </head>
      <body>{children}</body>
    </html>
  );
}
