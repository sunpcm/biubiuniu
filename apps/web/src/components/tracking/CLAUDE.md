# components/tracking/
> L2 | Parent: /CLAUDE.md

Third-party analytics tags and the browser touchpoint of first-party signup attribution. Every member is mounted from the root layout and renders nothing visible; each analytics tag self-disables when its env var is unset.

Files
- GoogleAnalytics.tsx: gtag.js loader, driven by GA_TRACKING_ID from gtag.js.
- GoogleAdsense.tsx: AdSense loader, NEXT_PUBLIC_GOOGLE_ADSENSE_ID.
- MicrosoftClarity.tsx: Clarity init, NEXT_PUBLIC_CLARITY_PROJECT_ID.
- PlausibleAnalytics.tsx: Plausible script plus the window.plausible queue shim, NEXT_PUBLIC_PLAUSIBLE_DOMAIN / _SRC.
- PostHogProvider.tsx: PostHog client init and provider, NEXT_PUBLIC_POSTHOG_KEY / _HOST.
- PostHogPageView.tsx: Pageview capture on route change, wrapped in Suspense for useSearchParams.
- RybbitScript.tsx: Rybbit tag with optional session replay, NEXT_PUBLIC_RYBBIT_SRC / _SITE_ID.
- UmamiScript.tsx: Umami tag, NEXT_PUBLIC_UMAMI_SRC / _UMAMI_WEBSITE_ID.
- ToltScript.tsx: Tolt affiliate tag, production only, NEXT_PUBLIC_TOLT_ID.
- UserSourceDeviceSync.tsx: First-party attribution, browser half — calls lib/tracking/client's syncTrackingDeviceInfo to top the device block into the attribution cookie. The source block is written by proxy.ts via lib/tracking/capture, so this component never creates the cookie.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
