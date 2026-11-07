/**
 * [INPUT]: Depends on the Card family of @/components/ui/card, Skeleton of @/components/ui/skeleton
 * [OUTPUT]: exports the BreakdownList and BreakdownListSkeleton components, the BreakdownRow type
 * [POS]: The distribution-list primitive of admin/overview — label / value /
 *        single-colour bar relative to the maximum; shared by the three
 *        breakdown cards, agnostic of where the data comes from
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export interface BreakdownRow {
  key: string;
  label: string;
  value: number;
  formatted: string;
}

interface BreakdownListProps {
  title: string;
  rows: BreakdownRow[];
  emptyText: string;
}

export function BreakdownList({ title, rows, emptyText }: BreakdownListProps) {
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={row.key}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate">{row.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {row.formatted}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${max > 0 ? (row.value / max) * 100 : 0}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function BreakdownListSkeleton() {
  return (
    <Card className="gap-4">
      <CardHeader>
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent className="space-y-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-14" />
            </div>
            <Skeleton className="h-1.5 w-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
