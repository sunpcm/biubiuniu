# components/auth/
> L2 | Parent: /CLAUDE.md

Authentication UI and the global auth behaviours mounted from the root layout.

Files
- AuthGuard.tsx: Server-side page guard for the dashboard layout: no session redirects to login (server.ts' isAdmin / isSuperAdmin are pure booleans, page redirects live here). A role check goes through getFreshSession so a demotion / ban / revoke lands immediately; the plain login check keeps the cookie-cache hot path.
- LoginForm.tsx: Login form (social providers, magic link, email OTP, Turnstile captcha) shared by the /login page and LoginDialog. Return hop is `callbackURL` prop > `?next=`, both sanitized through lib/url's sanitizeNextPath before reaching any channel (open-redirect guard). Magic-link signup passes no name — display sites fall back to the email, matching the OTP path. It does not touch signup attribution: that cookie is written by proxy.ts via lib/tracking/capture, because hanging it here would miss One Tap and every other entry point.
- LoginDialog.tsx: Login modal wrapper around LoginForm for in-page sign-in; passes the current pathname as callbackURL so the user lands back where they were.
- GoogleOneTap.tsx: Google One Tap prompt mounted in the root layout.
- ImpersonationBanner.tsx: Always-on "Viewing as …" banner while a superadmin borrows a session, with the exit back to the admin's own account.
- DeviceSignalCollector.tsx: Mounted in the root layout, renders nothing; computes the device-fingerprint hash via lib/signup-gift-gate/client and stores it in the device_signal cookie so the signup hook can run the gift cluster gate.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
