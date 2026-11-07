/**
 * [INPUT]: Depends on @/actions/overview for getOverviewAttention/OverviewAttention,
 *          @/actions/overview/range for OverviewRange, @/i18n/routing for Link,
 *          @/components/ui for Card/Badge/Skeleton, lucide-react icons,
 *          ./SectionError, @/lib/format for formatNumber, next-intl/server
 * [OUTPUT]: exports AttentionSection (async Server Component), AttentionSkeleton
 * [POS]: Right side of admin/overview's second row — the operations to-do list, one
 *        count per row + a link to the admin page that can act on it; when every
 *        count is zero it closes with an "all clear" badge
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { getOverviewAttention, type OverviewAttention } from "@/actions/overview";
import type { OverviewRange } from "@/actions/overview/range";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "@/i18n/routing";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ChevronRight,
  Clock,
  Globe,
  MessageSquareText,
  UserMinus,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { SectionError } from "./SectionError";

// ────────────────────────────────────────────────
//  List definition — a new item is one more line, rendering has no branches
// ────────────────────────────────────────────────

interface AttentionRow {
  key: keyof OverviewAttention;
  icon: LucideIcon;
  href: string;
}

const ROWS: AttentionRow[] = [
  { key: "pastDueSubscriptions", icon: AlertTriangle, href: "/dashboard/admin/users" },
  { key: "pendingOrders", icon: Clock, href: "/dashboard/admin/orders" },
  { key: "cancelScheduled", icon: UserMinus, href: "/dashboard/admin/users" },
  { key: "openFeedback", icon: MessageSquareText, href: "/dashboard/admin/feedbacks" },
  { key: "failedOrders", icon: XCircle, href: "/dashboard/admin/orders" },
  { key: "foreignCurrencyOrders", icon: Globe, href: "/dashboard/admin/orders" },
];

export async function AttentionSection({ range }: { range: OverviewRange }) {
  const [result, t, locale] = await Promise.all([
    getOverviewAttention(range),
    getTranslations("Overview"),
    getLocale(),
  ]);

  if (!result.success || !result.data) {
    return (
      <SectionError
        className="h-full"
        message={result.success ? t("error.empty") : result.error || t("error.load")}
      />
    );
  }

  const data = result.data;
  const allClear = ROWS.every((row) => data[row.key] === 0);

  return (
    <Card className="h-full gap-4">
      <CardHeader className="flex items-center justify-between">
        <CardTitle className="text-sm font-medium">{t("attention.title")}</CardTitle>
        {allClear && (
          <Badge
            variant="outline"
            className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          >
            {t("attention.allClear")}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        <ul className="-mx-2 divide-y divide-border/60">
          {ROWS.map(({ key, icon: Icon, href }) => {
            const value = data[key];
            const active = value > 0;
            return (
              <li key={key}>
                <Link
                  href={href}
                  className="flex items-center gap-3 rounded-md px-2 py-2.5 text-sm transition-colors hover:bg-muted/60"
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0",
                      active ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
                    )}
                    aria-hidden
                  />
                  <span className={cn("flex-1 truncate", !active && "text-muted-foreground")}>
                    {t(`attention.${key}`)}
                  </span>
                  <span
                    className={cn(
                      "tabular-nums",
                      active ? "font-semibold" : "text-muted-foreground"
                    )}
                  >
                    {formatNumber(value, locale)}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

export function AttentionSkeleton() {
  return (
    <Card className="h-full gap-4">
      <CardHeader>
        <Skeleton className="h-4 w-28" />
      </CardHeader>
      <CardContent className="space-y-3">
        {ROWS.map((row) => (
          <div key={row.key} className="flex items-center gap-3">
            <Skeleton className="size-4 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-6" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
