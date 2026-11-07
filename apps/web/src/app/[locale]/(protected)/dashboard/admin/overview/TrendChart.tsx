/**
 * [INPUT]: Depends on @/actions/overview's TrendPoint, @/components/ui/chart's
 *          ChartContainer/ChartTooltip/ChartTooltipContent, @/components/ui's
 *          Card/Tabs, recharts' BarChart family, @/lib/format's formatters,
 *          next-intl's useLocale/useTranslations
 * [OUTPUT]: exports the TrendChart component (Client Component)
 * [POS]: The only chart in admin/overview: a single-series bar chart with a
 *        metric switch (revenue/signups/orders/credits); the data ships once with
 *        the RSC and switching metrics never refetches; single series means no
 *        legend — the title is the legend
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import type { TrendPoint } from "@/actions/overview";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatCents,
  formatCurrency,
  formatDate,
  formatNumber,
} from "@/lib/format";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

type Metric = Exclude<keyof TrendPoint, "date">;

const METRICS: Metric[] = ["revenue", "signups", "orders", "creditsConsumed"];

interface TrendChartProps {
  currency: string;
  points: TrendPoint[];
}

export function TrendChart({ currency, points }: TrendChartProps) {
  const t = useTranslations("Overview");
  const locale = useLocale();
  const [metric, setMetric] = useState<Metric>("revenue");

  // Revenue is stored in cents — it alone needs currency formatting, the rest are counts
  const isMoney = metric === "revenue";
  const formatValue = (v: number) =>
    isMoney ? formatCents(v, currency, locale) : formatNumber(v, locale);
  const formatAxis = (v: number) =>
    isMoney
      ? formatCurrency(v / 100, currency, locale, {
          notation: "compact",
          maximumFractionDigits: 1,
        })
      : formatNumber(v, locale, { notation: "compact" });
  const formatDay = (day: string) =>
    formatDate(`${day}T00:00:00Z`, locale, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

  const total = points.reduce((sum, p) => sum + p[metric], 0);
  const label = t(`metric.${metric}`);
  const config = {
    [metric]: { label, color: "var(--chart-1)" },
  } satisfies ChartConfig;

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>{t("trend.title")}</CardTitle>
          <CardDescription>
            {t("trend.total", { metric: label, value: formatValue(total) })}
          </CardDescription>
        </div>
        <Tabs value={metric} onValueChange={(v) => setMetric(v as Metric)}>
          <TabsList>
            {METRICS.map((m) => (
              <TabsTrigger key={m} value={m}>
                {t(`metric.${m}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          // An all-zero series draws nothing but a row of 0 ticks — an empty state is more honest than a fake chart
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            {t("trend.empty", { metric: label })}
          </div>
        ) : (
          <ChartContainer config={config} className="aspect-auto h-64 w-full">
            <BarChart
              data={points}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              barCategoryGap="25%"
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={formatDay}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={56}
                allowDecimals={false}
                tickFormatter={formatAxis}
              />
              <ChartTooltip
                cursor={{ fill: "var(--muted)" }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(day) => formatDay(String(day))}
                    formatter={(value) => (
                      <div className="flex w-full items-center justify-between gap-4">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-mono font-medium tabular-nums text-foreground">
                          {formatValue(Number(value))}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              <Bar
                dataKey={metric}
                name={label}
                fill={`var(--color-${metric})`}
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
