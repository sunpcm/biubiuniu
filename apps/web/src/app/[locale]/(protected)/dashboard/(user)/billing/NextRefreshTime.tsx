/**
 * [INPUT]: Depends on next-intl's useLocale / useTranslations (Billing namespace),
 *          @/lib/format's formatDate, react's useEffect / useState
 * [OUTPUT]: Exports the NextRefreshTime client component
 * [POS]: The refresh-time display of dashboard/(user)/billing: the scheduler
 *        grants in UTC, this component shows that one instant both as the
 *        browser's local time (rendered after mount only, so the server's time
 *        zone cannot tear hydration) and as UTC
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { formatDate } from "@/lib/format";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/** `2026-08-01 00:00`: identical on server and client, so it is SSR-safe */
function formatUtc(date: Date): string {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

/**
 * Next credits refresh. The scheduler runs in UTC while the user thinks in
 * their own time zone, so both are shown. Local time depends on the browser
 * and can only render after mount; SSR paints the UTC form first.
 */
export function NextRefreshTime({ date }: { date: Date }) {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const utc = formatUtc(date);
  if (!mounted) {
    return (
      <span>
        {t("plan.nextRefresh", {
          date: t("plan.nextRefreshUtc", { date: utc }),
        })}
      </span>
    );
  }

  const local = formatDate(date, locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  return (
    <span>
      {t("plan.nextRefresh", { date: local })}
      <span className="ml-1.5 text-xs opacity-70">
        {t("plan.nextRefreshUtc", { date: utc })}
      </span>
    </span>
  );
}
