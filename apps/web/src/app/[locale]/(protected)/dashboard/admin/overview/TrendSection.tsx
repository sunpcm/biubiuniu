/**
 * [INPUT]: Depends on getOverviewTrend from @/actions/overview, OverviewRange from
 *          @/actions/overview/range, ./TrendChart, ./SectionError, Card/Skeleton from
 *          @/components/ui, getTranslations from next-intl/server
 * [OUTPUT]: exports TrendSection (async Server Component) and TrendSkeleton
 * [POS]: Left side of the second row in admin/overview — fetches the per-day series on
 *        the server and hands it to the client chart, which switches between metrics
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { getOverviewTrend } from "@/actions/overview";
import type { OverviewRange } from "@/actions/overview/range";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getTranslations } from "next-intl/server";
import { SectionError } from "./SectionError";
import { TrendChart } from "./TrendChart";

export async function TrendSection({ range }: { range: OverviewRange }) {
  const [result, t] = await Promise.all([
    getOverviewTrend(range),
    getTranslations("Overview"),
  ]);

  if (!result.success || !result.data) {
    return (
      <SectionError
        className="h-full"
        message={result.success ? t("error.empty") : result.error || t("error.load")}
      />
    );
  }

  return <TrendChart currency={result.data.currency} points={result.data.points} />;
}

export function TrendSkeleton() {
  return (
    <Card className="h-full">
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-36" />
        </div>
        <Skeleton className="h-9 w-64" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-64 w-full" />
      </CardContent>
    </Card>
  );
}
