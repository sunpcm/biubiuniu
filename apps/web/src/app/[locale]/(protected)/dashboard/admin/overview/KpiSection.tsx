/**
 * [INPUT]: Depends on @/actions/overview for getOverviewKpis/OverviewKpis,
 *          @/actions/overview/range for OverviewRange, ./StatTile, ./DeltaBadge,
 *          ./SectionError, @/lib/format for formatCents/formatNumber,
 *          next-intl/server for getTranslations/getLocale
 * [OUTPUT]: exports KpiSection (async Server Component), KpiSkeleton
 * [POS]: The first row of admin/overview — four tiles: net revenue / MRR / new
 *        signups / credits consumed, each tile = current-window value +
 *        period-over-period delta + a one-line footnote
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { getOverviewKpis, type OverviewKpis } from "@/actions/overview";
import type { OverviewRange } from "@/actions/overview/range";
import { formatCents, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { DeltaBadge } from "./DeltaBadge";
import { SectionError } from "./SectionError";
import { StatTile, StatTileSkeleton } from "./StatTile";

const GRID = "grid gap-4 sm:grid-cols-2 xl:grid-cols-4";

export async function KpiSection({ range }: { range: OverviewRange }) {
  const [result, t, locale] = await Promise.all([
    getOverviewKpis(range),
    getTranslations("Overview"),
    getLocale(),
  ]);

  if (!result.success || !result.data) {
    return (
      <SectionError
        message={result.success ? t("error.empty") : result.error || t("error.load")}
      />
    );
  }

  const k = result.data;
  const money = (cents: number) => formatCents(cents, k.currency, locale);
  const num = (n: number) => formatNumber(n, locale);

  return (
    <div className={GRID}>
      <StatTile
        label={t("kpi.revenue")}
        value={money(k.revenue.current)}
        action={<DeltaBadge {...k.revenue} />}
        footnote={t("kpi.revenueFootnote", {
          orders: num(k.orders.current),
          refunds: money(k.refunds),
        })}
      />
      <StatTile
        label={t("kpi.mrr")}
        value={money(k.mrr.cents)}
        action={<SubscriberMovement added={k.mrr.added} churned={k.mrr.churned} />}
        footnote={t("kpi.mrrFootnote", {
          subscribers: num(k.mrr.subscribers),
          trialing: num(k.mrr.trialing),
        })}
      />
      <StatTile
        label={t("kpi.signups")}
        value={num(k.signups.current)}
        action={<DeltaBadge {...k.signups} />}
        footnote={t("kpi.signupsFootnote", { total: num(k.totalUsers) })}
      />
      <StatTile
        label={t("kpi.credits")}
        value={num(k.creditsConsumed.current)}
        action={<DeltaBadge {...k.creditsConsumed} />}
        footnote={t("kpi.creditsFootnote", { users: num(k.activeUsers.current) })}
      />
    </div>
  );
}

/** Badge on the MRR tile: +added / −churned this window, falling back to neutral when zero */
function SubscriberMovement({
  added,
  churned,
}: Pick<OverviewKpis["mrr"], "added" | "churned">) {
  const t = useTranslations("Overview");
  return (
    <span
      title={t("kpi.mrrMovement")}
      className="inline-flex items-center gap-1 text-xs font-medium tabular-nums"
    >
      <span className={cn(added > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
        +{added}
      </span>
      <span className="text-muted-foreground">/</span>
      <span className={cn(churned > 0 ? "text-red-700 dark:text-red-400" : "text-muted-foreground")}>
        −{churned}
      </span>
    </span>
  );
}

export function KpiSkeleton() {
  return (
    <div className={GRID}>
      {[0, 1, 2, 3].map((i) => (
        <StatTileSkeleton key={i} />
      ))}
    </div>
  );
}
