/**
 * [INPUT]: depends on the resend SDK, ../types, ../encoding bufferToBase64, and ../retry retry logic
 * [OUTPUT]: exports resendProvider strategy object, sendEmailWithResend, addContactWithResend, removeContactWithResend
 * [POS]: lib/mail/providers Resend implementation, consumed by ../index.ts providers map and ../contacts.ts
 * [PROTOCOL]: Update this header when changed, then check CLAUDE.md
 */

import { Resend, type CreateEmailOptions } from "resend";
import type { EmailAddress, EmailProviderName, SendEmailOptions, SendEmailResult } from "../types";
import { bufferToBase64 } from "../encoding";
import { isRetryableHttpError, withRetry } from "../retry";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function normalizeAddress(addr: EmailAddress): string {
  if (typeof addr === "string") return addr;
  return addr.name ? `${addr.name} <${addr.email}>` : addr.email;
}

export const resendProvider = {
  name: "resend" as EmailProviderName,

  async send(options: SendEmailOptions): Promise<SendEmailResult> {
    if (!resend) {
      return {
        success: false,
        provider: "resend",
        error: new Error("RESEND_API_KEY is not set"),
      };
    }

    return withRetry(async () => {
      const payload: CreateEmailOptions = {
        from: normalizeAddress(options.from),
        to: options.to,
        subject: options.subject,
        ...(options.html ? { html: options.html } : {}),
        ...(options.text ? { text: options.text } : {}),
        ...(options.replyTo ? { replyTo: normalizeAddress(options.replyTo) } : {}),
        ...(options.cc ? { cc: options.cc } : {}),
        ...(options.bcc ? { bcc: options.bcc } : {}),
        ...(options.headers ? { headers: options.headers } : {}),
        ...(options.attachments
          ? {
              attachments: options.attachments.map((a) => ({
                filename: a.filename,
                content: typeof a.content === "string" ? a.content : bufferToBase64(a.content),
                contentType: a.type,
              })),
            }
          : {}),
      } as CreateEmailOptions;

      const { data, error } = await resend.emails.send(payload);

      if (error || !data) {
        const err = new Error(error?.message ?? "Resend send failed");
        (err as unknown as { status?: number }).status =
          error && typeof error === "object" && "statusCode" in error
            ? (error as { statusCode?: number }).statusCode
            : undefined;
        throw err;
      }

      return { success: true, provider: "resend", messageId: data.id };
    }, isRetryableHttpError);
  },
};

export async function sendEmailWithResend(options: SendEmailOptions): Promise<SendEmailResult> {
  return resendProvider.send(options);
}

export async function addContactWithResend(email: string): Promise<void> {
  if (!resend) return;
  await resend.contacts.create({ email });
}

export async function removeContactWithResend(email: string): Promise<void> {
  if (!resend) return;
  await resend.contacts.remove({ email });
}
