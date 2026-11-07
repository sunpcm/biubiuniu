/**
 * [INPUT]: Depends on getRecentOrders/RecentOrder of @/actions/overview,
 *          getPlanName/PaymentProvider of @/config/pricing, Link of @/i18n/routing,
 *          Card/Table/Button/Skeleton of @/components/ui, ./SectionError,
 *          formatCents/formatDate of @/lib/format, next-intl/server
 * [OUTPUT]: exports RecentOrdersSection (async Server Component), RecentOrdersSkeleton
 * [POS]: Row four of admin/overview — a read-only snapshot of the 8 most recent
 *        orders; type/status copy is reused from the Orders namespace, and
 *        "view all" jumps to the order management page
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { getRecentOrders } from "@/actions/overview";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getPlanName, type PaymentProvider } from "@/config/pricing";
import { Link } from "@/i18n/routing";
import type { OrderStatus } from "@/lib/db/schema";
import { formatCents, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { SectionError } from "./SectionError";

const PROVIDER_LABELS: Record<PaymentProvider, string> = {
  stripe: "Stripe",
  paypal: "PayPal",
  creem: "Creem",
};

// Status reads as "colour dot + text" — colour never carries meaning on its own
const STATUS_DOT: Record<OrderStatus, string> = {
  pending: "bg-sky-500",
  completed: "bg-emerald-500",
  partially_refunded: "bg-amber-500",
  refunded: "bg-red-500",
  failed: "bg-zinc-400",
};

export async function RecentOrdersSection() {
  const [result, t, tOrders, locale] = await Promise.all([
    getRecentOrders(),
    getTranslations("Overview"),
    getTranslations("Orders"),
    getLocale(),
  ]);

  if (!result.success || !result.data) {
    return (
      <SectionError
        message={result.success ? t("error.empty") : result.error || t("error.load")}
      />
    );
  }

  const rows = result.data;

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-sm font-medium">{t("recent.title")}</CardTitle>
        <CardAction>
          <Button asChild variant="ghost" size="sm" className="-mr-2">
            <Link href="/dashboard/admin/orders">
              {t("recent.viewAll")}
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("recent.empty")}</p>
        ) : (
          <div className="-mx-6 overflow-x-auto px-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tOrders("columns.user")}</TableHead>
                  <TableHead>{tOrders("columns.planId")}</TableHead>
                  <TableHead className="hidden md:table-cell">{tOrders("columns.orderType")}</TableHead>
                  <TableHead className="text-right">{tOrders("columns.amount")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{tOrders("columns.provider")}</TableHead>
                  <TableHead>{tOrders("columns.status")}</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">{tOrders("columns.createdAt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="max-w-56 truncate">
                      {o.userEmail ?? (
                        <span className="text-muted-foreground">{t("recent.deletedUser")}</span>
                      )}
                    </TableCell>
                    <TableCell>{getPlanName(o.planId, locale)}</TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {tOrders(`orderType.${o.orderType}`)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCents(o.amountTotal, o.currency, locale)}
                      {o.amountRefunded > 0 && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          −{formatCents(o.amountRefunded, o.currency, locale)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-muted-foreground">
                      {PROVIDER_LABELS[o.provider]}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <span className={cn("size-2 rounded-full", STATUS_DOT[o.status])} aria-hidden />
                        {tOrders(`status.${o.status}`)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right text-muted-foreground whitespace-nowrap">
                      {formatDate(o.createdAt, locale, { dateStyle: "medium", timeStyle: "short" })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RecentOrdersSkeleton() {
  return (
    <Card className="gap-4">
      <CardHeader>
        <Skeleton className="h-4 w-28" />
      </CardHeader>
      <CardContent className="space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
