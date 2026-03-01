import { Card, CardContent, CardHeader, CardTitle } from "@niu/ui/card";
import { Separator } from "@niu/ui/separator";
import { formatValue } from "@/lib/utils";
import { GrowthIndicator } from "./GrowthIndicator";

interface StatData {
  today: number | string;
  yesterday: number | string;
  growthRate: number;
}

interface CombinedStatCardProps {
  title: string;
  count: StatData;
  revenue: StatData;
  t: (key: string) => string;
}

export function CombinedStatCard({ title, count, revenue, t }: CombinedStatCardProps) {
  return (
    <Card className="from-background to-muted dark:to-muted/50 bg-linear-to-b">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-muted-foreground text-sm font-normal">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-semibold tabular-nums">
              {formatValue(count.today, "count")}
            </div>
            <p className="text-muted-foreground text-xs">
              {t("yesterday")}: {formatValue(count.yesterday, "count")}
            </p>
          </div>
          <GrowthIndicator rate={count.growthRate} />
        </div>

        <Separator className="my-2" />

        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">{formatValue(revenue.today, "revenue")}</div>
            <p className="text-muted-foreground text-xs">
              {t("yesterday")}: {formatValue(revenue.yesterday, "revenue")}
            </p>
          </div>
          <GrowthIndicator rate={revenue.growthRate} />
        </div>
      </CardContent>
    </Card>
  );
}
