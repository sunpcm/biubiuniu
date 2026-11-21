# lib/signup-gift-gate/
> L2 | Parent: /CLAUDE.md

The gate that grants the signup gift per identity cluster: the ledger enforces "once per user", this module enforces "a bounded number of times per cluster". One person cycling through throwaway emails and VPN exits gets a fresh account each time, but not a fresh device or network exit. The source IP and the device fingerprint each get their own counter; once either passes config/credits' signupGiftClusterCaps inside the window, the new account still registers, it just gets no gift. Division of labour with lib/signup-blocklist: the blocklist refuses the signup, this module only withholds the gift.

Files
- shared.ts: Constants and pure functions for both sides: DEVICE_SIGNAL_COOKIE_NAME / DEVICE_SIGNAL_COOKIE_MAX_AGE_DAYS (one day, then recomputed) / isValidDeviceHash (16 to 64 hex chars, the only gate before a cookie value becomes part of a Redis key).
- client.ts: The collection half ('use client'), called by components/auth/DeviceSignalCollector from the root layout. saveDeviceSignal gathers signals that follow the person rather than the network (UA, platform, language, screen size and depth, DPR, time zone, CPU cores, memory tier, touch points, WebGL GPU model), hashes them with SHA-256 (FNV-1a outside a secure context) and writes the cookie. An existing cookie is left alone, every failure is silent, and only the hash is uploaded; the raw signals never leave the browser.
- index.ts: The decision half (server-only), consumed by lib/auth/signup-rewards, which logs a warn and sends Discord notifySignupGiftWithheld when the gift is withheld. decideSignupGift INCRs both signals (first write attaches the windowDays TTL; the key factories are lib/redis/redis-keys' platform.signupGiftIp / signupGiftDevice), counts signups rather than gifts so a cluster past its cap keeps climbing and never regains the chance inside the window, counts both signals before deciding so the device ledger stays continuous when the IP is already over, and readDeviceSignalCookie accepts only a well-formed hash. No Redis client, no signals or a Redis error all mean grant=true.

Pitfalls
- Missing signals and Redis failures always let the gift through. The gate's own failure must never leave a genuine new user empty-handed; do not turn this fail-closed.
- The device cookie is client input: beyond the shape check nothing in it is trusted. Never send the raw signals (UA / time zone / GPU string) to the server or store them.
- Without a configured Redis the whole gate is silently off (the gift is always granted). That is the intended degraded posture, not a bug.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
