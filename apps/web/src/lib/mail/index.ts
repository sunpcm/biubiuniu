/**
 * [INPUT]: depends on resend/cloudflare provider implementations, ./contacts for contact management, and ./render for React-to-HTML rendering
 * [OUTPUT]: exports sendEmail (unified entry), getDefaultEmailProvider, and re-exports providers/contacts/types
 * [POS]: lib/mail unified entry point and the single email-sending call site for newsletter/contact/auth code
 * [PROTOCOL]: Update this header when changed, then check CLAUDE.md
 */

import "server-only";

import * as React from "react";
import type { EmailProviderName, SendEmailOptions, SendEmailResult } from "./types";
import { resendProvider } from "./providers/resend";
import { cloudflareProvider } from "./providers/cloudflare";
import { addContact as addContactInternal } from "./contacts";
import { renderEmailToHtml, htmlToPlainText } from "./render";

const providers: Record<
  EmailProviderName,
  { name: EmailProviderName; send(options: SendEmailOptions): Promise<SendEmailResult> }
> = {
  resend: resendProvider,
  cloudflare: cloudflareProvider,
};

export function getDefaultEmailProvider(): EmailProviderName {
  const env = process.env.DEFAULT_EMAIL_PROVIDER;
  if (env === "cloudflare") return "cloudflare";
  // Default to Resend to preserve pre-upgrade behavior.
  return "resend";
}

async function resolveBody(
  options: SendEmailOptions
): Promise<Pick<SendEmailOptions, "html" | "text">> {
  let html = options.html;

  if (!html && options.react) {
    const element = options.reactProps
      ? React.createElement(options.react as React.ComponentType<any>, options.reactProps)
      : (options.react as React.ReactElement);
    html = await renderEmailToHtml(element);
  }

  // Generate the text fallback here so providers do not duplicate the work.
  const text = options.text ?? (html ? htmlToPlainText(html) : undefined);
  return { html, text };
}

export async function sendEmail(
  options: SendEmailOptions,
  provider?: EmailProviderName
): Promise<SendEmailResult> {
  const name = provider ?? getDefaultEmailProvider();
  const impl = providers[name];
  if (!impl) {
    return {
      success: false,
      provider: name,
      error: new Error(`Unknown email provider: ${name}`),
    };
  }

  try {
    const body = await resolveBody(options);
    const result = await impl.send({ ...options, ...body });

    if (result.success && options.addToContacts) {
      const firstRecipient = Array.isArray(options.to) ? options.to[0] : options.to;
      if (firstRecipient) {
        await addContactInternal(firstRecipient, name).catch(() => {
          // Contact write failures should not block returning a successful send result.
        });
      }
    }

    return result;
  } catch (error) {
    return {
      success: false,
      provider: name,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export { sendEmailWithResend } from "./providers/resend";
export { sendEmailWithCloudflare } from "./providers/cloudflare";
export { addContact, removeContact, isContact } from "./contacts";
export * from "./types";
