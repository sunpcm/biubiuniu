/**
 * [INPUT]: Depends on OVERVIEW_RANGES/OverviewRange from @/actions/overview/range,
 *          Link from @/i18n/routing, useTranslations from next-intl, cn from @/lib/utils
 * [OUTPUT]: exports the RangeSwitcher component
 * [POS]: The only filter in the admin/overview page header — a pure-link segmented
 *        control (zero client JS) that rewrites the URL via ?range=, making it
 *        bookmarkable and shareable, with every section refetching along with it
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { OVERVIEW_RANGES, type OverviewRange } from "@/actions/overview/range";
import { Link } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

export function RangeSwitcher({ range }: { range: OverviewRange }) {
  const t = useTranslations("Overview");
  return (
    <nav
      aria-label={t("range.label")}
      className="inline-flex h-9 w-fit items-center rounded-lg bg-muted p-[3px] text-muted-foreground"
    >
      {OVERVIEW_RANGES.map((r) => {
        const active = r === range;
        return (
          <Link
            key={r}
            href={`/dashboard/admin/overview?range=${r}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-full items-center rounded-md px-3 text-sm font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "hover:text-foreground"
            )}
          >
            {t(`range.${r}`)}
          </Link>
        );
      })}
    </nav>
  );
}
