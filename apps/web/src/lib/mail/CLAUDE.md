# lib/mail/
> L2 | Parent: /CLAUDE.md

Multi-provider email abstraction (Resend + Cloudflare Email Sending). All business code calls sendEmail() from here; the provider is chosen by DEFAULT_EMAIL_PROVIDER.

Files
- types.ts: Shared contracts — SendEmailOptions, SendEmailResult, EmailProviderName, EmailAttachment.
- render.tsx: React Email to HTML renderer (dynamic react-dom/server import) plus an HTML-to-plain-text helper.
- retry.ts: One-shot delayed retry wrapper and an HTTP-status retry classifier.
- encoding.ts: Base64 / ArrayBuffer helpers that work in both Node and Edge runtimes.
- contacts.ts: Contact list abstraction — writes to Resend contacts when Resend is the default provider, always mirrors to Redis.
- index.ts: Unified entry point — sendEmail() routes to the selected provider and handles React rendering, text fallback and contact bookkeeping.
- providers/resend.ts: Resend implementation plus Resend-specific contact helpers.
- providers/cloudflare.ts: Cloudflare Email Sending via the official `cloudflare` SDK REST API (server / Vercel deployments).

Design rules
- Provider-specific quirks (address field names, attachment encoding, retry behaviour) stay inside providers/.
- react-dom/server must stay dynamically imported in render.tsx; a top-level import breaks some Edge builds.
- Contact mutations are best-effort and must never fail the send.
- This branch targets server / Vercel deployments, so the Cloudflare provider uses the REST API. Cloudflare Workers deployments use the dedicated branch with the send_email binding.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
