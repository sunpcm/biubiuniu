/**
 * [INPUT]: Depends on @/lib/format's formatNumber, next-intl's useLocale/useTranslations,
 *          lucide-react icons, @/lib/utils' cn
 * [OUTPUT]: exports the DeltaBadge component
 * [POS]: The period-over-period badge on admin/overview KPI cards — the single exit for
 *        "up/down" semantics: color = direction × whether up is good (invert); with no
 *        comparison baseline it degrades to text instead of ∞
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

interface DeltaBadgeProps {
  current: number;
  previous: number;
  /** Set when lower is better for the metric (e.g. churn, refunds) */
  invert?: boolean;
}

export function DeltaBadge({ current, previous, invert = false }: DeltaBadgeProps) {
  const t = useTranslations("Overview");
  const locale = useLocale();

  if (previous === 0) {
    return (
      <span className="text-xs text-muted-foreground">{t("delta.noBaseline")}</span>
    );
  }

  const ratio = (current - previous) / previous;
  const flat = ratio === 0;
  const good = ratio > 0 !== invert;
  const Icon = flat ? Minus : ratio > 0 ? TrendingUp : TrendingDown;

  return (
    <span
      title={t("delta.vsPrevious")}
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        flat
          ? "text-muted-foreground"
          : good
            ? "text-emerald-700 dark:text-emerald-400"
            : "text-red-700 dark:text-red-400"
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {formatNumber(ratio, locale, {
        style: "percent",
        signDisplay: "exceptZero",
        maximumFractionDigits: 1,
      })}
    </span>
  );
}
