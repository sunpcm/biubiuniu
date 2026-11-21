/**
 * Legacy cross-app SSO login page — retired.
 *
 * The previous LearnFeynmanHelper hand-off forwarded a long-lived JWT through
 * an arbitrary `redirect`/`postMessage` target and, with no opener, embedded
 * the token directly in the URL. It is intentionally not carried forward.
 * This route exists only so the old entry point resolves to a clear,
 * non-redirecting "closed" notice instead of an ambiguous error.
 *
 * No request parameter (redirect/state/code/token) is read, echoed or used to
 * build a URL or a cross-window message. There is no client JavaScript here.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cross-app sign-in retired",
  robots: { index: false, follow: false },
};

export default function LegacyCrossLoginClosedPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        fontFamily:
          "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        backgroundColor: "#f8fafc",
        color: "#0f172a",
      }}
    >
      <section
        style={{
          maxWidth: 560,
          width: "100%",
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: "2rem",
          boxShadow: "0 1px 3px rgba(15, 23, 42, 0.08)",
        }}
      >
        <h1
          style={{
            fontSize: "1.5rem",
            lineHeight: 1.25,
            margin: "0 0 0.75rem",
          }}
        >
          Cross-app sign-in has been retired
        </h1>
        <p
          style={{
            margin: "0 0 1rem",
            color: "#475569",
            lineHeight: 1.6,
          }}
        >
          The legacy single sign-on hand-off between the learning app and this
          product is no longer available. It will not issue, refresh or verify
          tokens, and it will not redirect you to another site.
        </p>
        <p
          style={{
            margin: 0,
            color: "#64748b",
            lineHeight: 1.6,
          }}
        >
          跨应用单点登录已停用。此页面不会签发、续期或校验令牌，也不会跳转到
          其他站点。
        </p>
      </section>
    </main>
  );
}
