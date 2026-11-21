/**
 * [INPUT]: Depends on @/components/ui/card for the Card family, @/components/ui/skeleton for Skeleton
 * [OUTPUT]: exports the StatTile and StatTileSkeleton components
 * [POS]: The KPI tile primitive of admin/overview — four slots: label / value /
 *        top-right action / footnote, agnostic to what the metric means; values
 *        use proportional figures (no tabular-nums for the large display)
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReactNode } from "react";

interface StatTileProps {
  label: string;
  value: string;
  footnote?: ReactNode;
  action?: ReactNode;
}

export function StatTile({ label, value, footnote, action }: StatTileProps) {
  return (
    <Card className="gap-4 py-5">
      <CardHeader className="px-5">
        <CardDescription>{label}</CardDescription>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="px-5">
        <div className="text-3xl font-semibold tracking-tight">{value}</div>
        {footnote && (
          <p className="mt-1.5 text-xs text-muted-foreground">{footnote}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function StatTileSkeleton() {
  return (
    <Card className="gap-4 py-5">
      <CardHeader className="px-5">
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent className="space-y-2 px-5">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-3 w-40" />
      </CardContent>
    </Card>
  );
}
