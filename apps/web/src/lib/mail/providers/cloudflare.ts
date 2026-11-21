/**
 * [INPUT]: depends on the cloudflare SDK (REST API), ../types, ../encoding bufferToBase64, and ../retry
 * [OUTPUT]: exports cloudflareProvider strategy object and sendEmailWithCloudflare
 * [POS]: lib/mail/providers Cloudflare Email Sending implementation, consumed by ../index.ts providers map
 * [PROTOCOL]: Update this header when changed, then check CLAUDE.md
 *
 * Note:
 * - This branch targets server / Vercel deployments, so Cloudflare Email Sending uses the
 *   cloudflare SDK REST API.
 * - Cloudflare Workers deployments should use the dedicated cf-pg branch which adds the
 *   send_email binding.
 */

import Cloudflare from "cloudflare";
import { bufferToBase64 } from "../encoding";
import { isRetryableHttpError, withRetry } from "../retry";
import type { EmailAddress, EmailProviderName, SendEmailOptions, SendEmailResult } from "../types";

const client = process.env.CLOUDFLARE_EMAIL_API_TOKEN
  ? new Cloudflare({ apiToken: process.env.CLOUDFLARE_EMAIL_API_TOKEN })
  : null;

function normalizeRestAddress(addr: EmailAddress): string | { address: string; name: string } {
  return typeof addr === "string" ? addr : { address: addr.email, name: addr.name ?? "" };
}

export const cloudflareProvider = {
  name: "cloudflare" as EmailProviderName,

  async send(options: SendEmailOptions): Promise<SendEmailResult> {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!client || !accountId) {
      return {
        success: false,
        provider: "cloudflare",
        error: new Error("CLOUDFLARE_EMAIL_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required"),
      };
    }

    return withRetry(async () => {
      const result = await client.emailSending.send({
        account_id: accountId,
        to: options.to,
        from: normalizeRestAddress(options.from),
        subject: options.subject,
        html: options.html,
        text: options.text,
        reply_to: options.replyTo ? normalizeRestAddress(options.replyTo) : undefined,
        cc: options.cc,
        bcc: options.bcc,
        headers: options.headers,
        attachments: options.attachments?.map((a) => {
          const base = {
            content: typeof a.content === "string" ? a.content : bufferToBase64(a.content),
            filename: a.filename,
            type: a.type,
          };
          if (a.disposition === "inline") {
            return {
              ...base,
              disposition: "inline" as const,
              content_id: a.contentId ?? a.filename,
            };
          }
          return { ...base, disposition: "attachment" as const };
        }),
      });

      return {
        success: true,
        provider: "cloudflare",
        messageId: result.message_id,
        delivered: result.delivered,
        queued: result.queued,
        bounced: result.permanent_bounces,
      };
    }, isRetryableHttpError);
  },
};

export async function sendEmailWithCloudflare(options: SendEmailOptions): Promise<SendEmailResult> {
  return cloudflareProvider.send(options);
}
