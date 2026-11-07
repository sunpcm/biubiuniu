/**
 * Auth mail port. Binds the app's `sendEmail` + React email templates to the
 * React-free `AuthMailer` contract consumed by `@sunpcm/niu-auth`. This is the
 * only place the auth core's mail paths touch React templates; the core itself
 * stays free of any Next/React/email dependency.
 */

import "server-only";

import type { AuthMailer } from "@sunpcm/niu-auth";
import { siteConfig } from "@/config/site";
import MagicLinkEmail from "@/emails/magic-link-email";
import OTPCodeEmail from "@/emails/otp-code-email";
import { UserWelcomeEmail } from "@/emails/user-welcome";
import { OrganizationInvitationEmail } from "@/emails/organization-invitation";
import { sendEmail } from "@/lib/mail";
import { getLogger } from "@/lib/logger";

function adminFrom(): { email: string; name: string } {
  const email = process.env.DEFAULT_ADMIN_EMAIL;
  if (!email) throw new Error("DEFAULT_ADMIN_EMAIL is not configured");
  return { email, name: process.env.DEFAULT_ADMIN_NAME || siteConfig.name };
}

export function createAuthMailer(): AuthMailer {
  const logger = getLogger("auth");

  return {
    async sendMagicLink({ email, url }) {
      const from = adminFrom();
      const result = await sendEmail({
        to: email,
        from,
        subject: `Sign in to ${siteConfig.name}`,
        react: MagicLinkEmail,
        reactProps: { url },
      });
      if (!result.success) {
        throw result.error ?? new Error("Failed to send magic link email");
      }
    },

    async sendVerificationOtp({ email, otp, type }) {
      const from = adminFrom();
      const result = await sendEmail({
        to: email,
        from,
        subject: `Your ${siteConfig.name} verification code: ${otp}`,
        react: OTPCodeEmail,
        reactProps: { otp, type },
      });
      if (!result.success) {
        throw result.error ?? new Error("Failed to send OTP email");
      }
    },

    async sendWelcome({ email, name, unsubscribeLink }) {
      if (!process.env.DEFAULT_ADMIN_EMAIL) {
        logger.warn(
          {},
          "DEFAULT_ADMIN_EMAIL is not configured, skipping welcome email.",
        );
        return;
      }
      const result = await sendEmail({
        to: email,
        from: adminFrom(),
        subject: `Welcome to ${siteConfig.name}!`,
        react: UserWelcomeEmail,
        reactProps: { name, email, unsubscribeLink },
        addToContacts: true,
      });
      if (result.success) {
        logger.info({ email }, `Welcome email sent to ${email}`);
      } else {
        logger.error(
          result.error ?? new Error("Failed to send welcome email"),
          "Failed to send welcome email",
        );
      }
    },

    async sendOrganizationInvitation({
      email,
      url,
      organizationName,
      inviterName,
      inviterEmail,
    }) {
      const from = adminFrom();
      const result = await sendEmail({
        to: email,
        from,
        subject: `You're invited to join ${organizationName} on ${siteConfig.name}`,
        react: OrganizationInvitationEmail,
        reactProps: { url, organizationName, inviterName, inviterEmail },
      });
      if (!result.success) {
        throw result.error ?? new Error("Failed to send invitation email");
      }
    },
  };
}
