# lib/tracking/
> L2 | Parent: /CLAUDE.md

Signup-source attribution: where a new user came from, captured at the edge and persisted as a `user_source` row at signup. Gated by NEXT_PUBLIC_USER_SOURCE_TRACKING_ENABLED, with consent honoured through NEXT_PUBLIC_COOKIE_CONSENT_ENABLED.

Files
- shared.ts: Source of truth — the ClientTrackingData / AttributionBlock / ParsedUserAgent / GeoLocationData / UserSourceData types, TRACKING_COOKIE_NAME + TRACKING_COOKIE_MAX_AGE_DAYS, CONSENT_COOKIE_NAME, isTrackingEnabled / isTrackingConsentGranted, parseTrackingCookie (tolerates both decoded and legacy encoded values), hasAttributionSignal, readAttributionFromRequest, mergeAttribution. Pure functions, no runtime deps — browser, proxy and server all import the same rules.
- capture.ts: Request half — captureAttributionCookie(request, response), the only consumer being proxy.ts. Skips anything that is not a real document navigation (rsc / next-router-prefetch / purpose / sec-purpose headers), rebuilds the public landing-page URL from x-forwarded-host / x-forwarded-proto, and writes the cookie under mergeAttribution.
- client.ts: Browser half — syncTrackingDeviceInfo() tops screen / language / timezone into a cookie that already exists, and never creates one. Mounted via components/tracking/UserSourceDeviceSync.
- server.ts: Persistence half — parseUserAgent (bowser), getCloudflareGeoHeaders, extractReferrerDomain, getUserAgentFromHeaders, buildUserSourceData, saveUserSource; called by the user.create.after hook in lib/auth/index.ts, which then deletes the cookie.

Design rules
- The attribution block belongs to the proxy, the device block to the browser. Two writers, disjoint field sets, no contention.
- Capture must not hang off a login component: One Tap, OAuth and magic-link landings never render the login form, and attribution hung there is attribution lost.
- First touch carrying a signal wins. A signal is any utm field, aff code or off-site referrer; landingPage alone is not one, so a direct visit never overwrites a real source.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
