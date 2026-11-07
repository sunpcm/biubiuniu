import withBundleAnalyzer from "@next/bundle-analyzer";
import { withSentryConfig } from "@sentry/nextjs/config";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  redirects: async () => [
    {
      source: "/ja",
      destination: "/",
      permanent: false,
    },
    {
      source: "/ja/:path*",
      destination: "/:path*",
      permanent: false,
    },
    {
      source: "/dashboard",
      destination: "/dashboard/settings",
      permanent: true,
    },
    {
      source: "/zh/dashboard",
      destination: "/zh/dashboard/settings",
      permanent: true,
    },
  ],
  images: {
    unoptimized: process.env.NEXT_PUBLIC_OPTIMIZED_IMAGES === "false",
    remotePatterns: [
      ...(process.env.R2_PUBLIC_URL
        ? [
            {
              hostname: process.env.R2_PUBLIC_URL.replace("https://", ""),
            },
          ]
        : []),
    ],
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error"] } : false,
  },
  // Pino uses worker threads for transports — must be treated as external in Next.js
  serverExternalPackages: ["pino", "pino-pretty", "pino-roll", "thread-stream"],
  // Keep the incoming proxy origin so next-intl's absolute rewrites remain parseable.
  skipProxyUrlNormalize: true,
};

const withBundleAnalyzerWrapper = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const sentryConfig = {
  silent: !process.env.CI,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
};

export default withSentryConfig(withBundleAnalyzerWrapper(withNextIntl(nextConfig)), sentryConfig);
