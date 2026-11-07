/**
 * [INPUT]: Depends on @/config/site's siteConfig (brand name / site URL / logo)
 * [OUTPUT]: Exports the OrganizationInvitationEmail component (team invitation email)
 * [POS]: The team invitation template of emails/, consumed by the
 *        sendInvitationEmail callback in lib/auth/organization.ts; styling
 *        aligned with magic-link-email
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */
import { siteConfig } from "@/config/site";
import * as React from "react";

interface OrganizationInvitationEmailProps {
  /** Accept link: /accept-invitation/{invitationId} */
  url: string;
  organizationName: string;
  inviterName?: string | null;
  inviterEmail?: string | null;
}

const styles = {
  container: {
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    maxWidth: "600px",
    margin: "0 auto",
    backgroundColor: "#f8fafc",
    padding: "40px 20px",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    padding: "40px",
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
    textAlign: "center" as const,
  },
  headerTitle: {
    fontSize: "24px",
    fontWeight: "bold",
    color: "#3b82f6",
    margin: "0 0 24px 0",
  },
  contentTitle: {
    fontSize: "20px",
    fontWeight: "600",
    color: "#1f2937",
    margin: "0 0 24px 0",
  },
  paragraph: {
    fontSize: "16px",
    lineHeight: "1.6",
    color: "#4b5563",
    margin: "0 0 24px 0",
  },
  buttonContainer: {
    margin: "24px 0",
  },
  button: {
    display: "inline-block",
    backgroundColor: "#3b82f6",
    color: "#ffffff",
    textDecoration: "none",
    padding: "12px 24px",
    borderRadius: "6px",
    fontWeight: "500",
    fontSize: "16px",
  },
  ignoreText: {
    fontSize: "14px",
    color: "#9ca3af",
    margin: "24px 0 0",
  },
  footer: {
    marginTop: "32px",
    paddingTop: "24px",
    borderTop: "1px solid #e5e7eb",
    textAlign: "center" as const,
  },
  footerText: {
    fontSize: "12px",
    color: "#9ca3af",
    margin: "0",
  },
  logo: {
    width: "80px",
    height: "80px",
    backgroundColor: "#000000",
    borderRadius: "50%",
    margin: "0 auto 24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "36px",
    fontWeight: "bold",
    color: "#ffffff",
  },
};

export const OrganizationInvitationEmail: React.FC<
  Readonly<OrganizationInvitationEmailProps>
> = ({ url, organizationName, inviterName, inviterEmail }) => {
  const inviter = inviterName || inviterEmail || "A teammate";
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <img
            src={`${siteConfig.url}/logo.png`}
            alt={siteConfig.name}
            width={80}
            height={80}
          />
        </div>

        <h1 style={styles.headerTitle}>
          <a
            href={siteConfig.url}
            style={{ textDecoration: "none", color: "#3b82f6" }}
          >
            {siteConfig.name}
          </a>
        </h1>

        <h2 style={styles.contentTitle}>
          Join {organizationName} on {siteConfig.name}
        </h2>

        <p style={styles.paragraph}>
          {inviter} invited you to join the team &quot;{organizationName}&quot;
          on {siteConfig.name}. Accept the invitation to collaborate with a
          shared credit pool.
        </p>

        <div style={styles.buttonContainer}>
          <a href={url} style={styles.button}>
            Accept Invitation
          </a>
        </div>

        <p style={styles.ignoreText}>
          If you weren&apos;t expecting this invitation, you can safely ignore
          this email.
        </p>
      </div>

      <div style={styles.footer}>
        <p style={styles.footerText}>
          © {new Date().getFullYear()} {siteConfig.name}. All rights reserved.
        </p>
      </div>
    </div>
  );
};

export default OrganizationInvitationEmail;
