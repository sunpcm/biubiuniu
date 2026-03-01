// [CUSTOM: START] - Standalone auth layout for cross-login page (separate from [locale]/layout.tsx)
import { AuthProvider } from "@/components/providers/AuthProvider";
import { cn } from "@niu/utils";
import "@/styles/globals.css";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { ThemeProvider } from "next-themes";
import { Inter as FontSans } from "next/font/google";
import { siteConfig } from "@/config/site";

const fontSans = FontSans({
  subsets: ["latin"],
  variable: "--font-sans",
});

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const messages = await getMessages();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={cn("bg-background flex min-h-screen flex-col", fontSans.variable)}>
        <NextIntlClientProvider messages={messages}>
          <AuthProvider>
            <ThemeProvider
              attribute="class"
              defaultTheme={siteConfig.defaultNextTheme}
              enableSystem
            >
              {children}
            </ThemeProvider>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
// [CUSTOM: END]
