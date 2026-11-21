/**
 * [INPUT]: depends on React's ComponentType/ReactElement types
 * [OUTPUT]: exports EmailAddress, EmailAttachment, SendEmailOptions, SendEmailResult, EmailProviderName
 * [POS]: lib/mail type contract layer, consumed by index.ts, providers, and contacts.ts
 * [PROTOCOL]: Update this header when changed, then check CLAUDE.md
 */

import type * as React from "react";

export type EmailAddress = string | { email: string; name?: string };

export interface EmailAttachment {
  content: string | ArrayBuffer;
  filename: string;
  type: string;
  disposition?: "attachment" | "inline";
  contentId?: string;
}

export interface SendEmailOptions {
  to: string | string[];
  from: EmailAddress;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: EmailAddress;
  cc?: string | string[];
  bcc?: string | string[];
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
  /** React email template component (mutually exclusive with html; html takes precedence) */
  react?: React.ComponentType<any> | React.ReactElement;
  /** Props passed to the React component */
  reactProps?: Record<string, any>;
  /** Whether to add the first recipient to the contact list after sending successfully */
  addToContacts?: boolean;
}

export interface SendEmailResult {
  success: boolean;
  provider: EmailProviderName;
  /** Message id returned by the provider */
  messageId?: string;
  /** Addresses reported as delivered by the Cloudflare REST API */
  delivered?: string[];
  /** Addresses reported as queued by the Cloudflare REST API */
  queued?: string[];
  /** Addresses reported as permanently bounced by the Cloudflare REST API */
  bounced?: string[];
  error?: Error;
}

export type EmailProviderName = "resend" | "cloudflare";
