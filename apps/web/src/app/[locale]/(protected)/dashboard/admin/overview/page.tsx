/**
 * [INPUT]: Depends on @/actions/overview/range's parseRange/resolveWindow,
 *          ./RangeSwitcher, ./KpiSection, ./TrendSection, ./AttentionSection,
 *          ./BreakdownSection, ./RecentOrdersSection and their skeletons,
 *          @/lib/metadata's constructMetadata, next-intl's getTranslations
 * [OUTPUT]: exports default AdminOverviewPage, generateMetadata
 * [POS]: The route entry of admin/overview (Server Component): parses ?range=
 *        and hands the same time window to five independent Suspense sections,
 *        each fetching in parallel and streaming in on its own
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { parseRange, resolveWindow } from "@/actions/overview/range";
import { constructMetadata } from "@/lib/metadata";
import { requireValidatedLocale } from "@/i18n/validated-locale";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AttentionSection, AttentionSkeleton } from "./AttentionSection";
import { BreakdownSection, BreakdownSkeleton } from "./BreakdownSection";
import { KpiSection, KpiSkeleton } from "./KpiSection";
import { RangeSwitcher } from "./RangeSwitcher";
import { RecentOrdersSection, RecentOrdersSkeleton } from "./RecentOrdersSection";
import { TrendSection, TrendSkeleton } from "./TrendSection";

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<{ range?: string | string[] }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { locale } = await params;
  const validatedLocale = requireValidatedLocale(locale);
  const t = await getTranslations({ locale: validatedLocale, namespace: "Overview" });
  return constructMetadata({
    title: t("title"),
    description: t("description"),
    locale: validatedLocale,
    path: `/dashboard/admin/overview`,
  });
}

export default async function AdminOverviewPage({
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const [{ range: rawRange }, t] = await Promise.all([
    searchParams,
    getTranslations("Overview"),
  ]);
  const range = parseRange(rawRange);
  const { days } = resolveWindow(range);

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header: title + scope note + the one time-window filter ── */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle", { days })}</p>
        </div>
        <RangeSwitcher range={range} />
      </header>

      {/* ── Row 1: four KPI cards ── */}
      <Suspense fallback={<KpiSkeleton />}>
        <KpiSection range={range} />
      </Suspense>

      {/* ── Row 2: trend chart + needs attention ── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <Suspense fallback={<TrendSkeleton />}>
            <TrendSection range={range} />
          </Suspense>
        </div>
        <Suspense fallback={<AttentionSkeleton />}>
          <AttentionSection range={range} />
        </Suspense>
      </div>

      {/* ── Row 3: three breakdowns ── */}
      <Suspense fallback={<BreakdownSkeleton />}>
        <BreakdownSection range={range} />
      </Suspense>

      {/* ── Row 4: recent orders ── */}
      <Suspense fallback={<RecentOrdersSkeleton />}>
        <RecentOrdersSection />
      </Suspense>
    </div>
  );
}
