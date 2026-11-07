/**
 * [INPUT]: Depends on getUserDetailForAdmin of @/actions/users/admin (user profile
 *          + credit balance + subscription + lifetime stats in a single RPC),
 *          getPlanName of @/config/pricing,
 *          Link/Locale of @/i18n/routing,
 *          formatDate/formatNumber of @/lib/format (the single locale-aware
 *          formatting channel — this page builds no Intl instances of its own),
 *          constructMetadata of @/lib/metadata, Avatar/Badge/Button/Card of
 *          @/components/ui, ./AdjustCreditsButton, ./CopyText, ./UserHistoryTabs,
 *          getTranslations of next-intl/server
 * [OUTPUT]: exports default AdminUserDetailPage, generateMetadata
 * [POS]: The route entry of admin/users/[userId] (Server Component) — the user
 *        detail page: profile header card + three stat cards (balance /
 *        subscription / lifetime); the history ledger is left to client Tabs
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { getUserDetailForAdmin } from "@/actions/users/admin";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getPlanName } from "@/config/pricing";
import { Link as I18nLink, Locale } from "@/i18n/routing";
import { formatDate, formatNumber } from "@/lib/format";
import { constructMetadata } from "@/lib/metadata";
import {
  ArrowLeft,
  CalendarClock,
  Coins,
  CreditCard,
  TrendingUp,
} from "lucide-react";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AdjustCreditsButton } from "./AdjustCreditsButton";
import { CopyText } from "./CopyText";
import { UserHistoryTabs } from "./UserHistoryTabs";

type Params = Promise<{ locale: string; userId: string }>;

type MetadataProps = {
  params: Params;
};

export async function generateMetadata({
  params,
}: MetadataProps): Promise<Metadata> {
  const { locale, userId } = await params;
  const t = await getTranslations({
    locale,
    namespace: "Users",
  });

  return constructMetadata({
    title: t("detail.title"),
    description: t("description"),
    locale: locale as Locale,
    path: `/dashboard/admin/users/${userId}`,
  });
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Params;
}) {
  const { locale, userId } = await params;
  const [result, t] = await Promise.all([
    getUserDetailForAdmin({ userId }),
    getTranslations("Users"),
  ]);

  const backLink = (
    <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
      <I18nLink href="/dashboard/admin/users">
        <ArrowLeft className="size-4" />
        {t("detail.back")}
      </I18nLink>
    </Button>
  );

  // ── error / not-found state ──
  if (!result.success || !result.data) {
    const isNotFound = !result.success && result.error === "User not found.";
    return (
      <div className="space-y-6">
        {backLink}
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-lg font-semibold">
              {isNotFound ? t("detail.notFound") : t("detail.loadFailed")}
            </p>
            {!result.success && !isNotFound && (
              <p className="mt-1 text-sm text-muted-foreground">
                {result.error}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const { user, billing, lifetime } = result.data;
  const sub = billing.subscription;

  const displayName = user.name || user.email;
  const planName = sub ? getPlanName(sub.planId, locale) : null;
  const statusLabel = sub
    ? t.has(`detail.subscription.status.${sub.status}`)
      ? t(`detail.subscription.status.${sub.status}`)
      : sub.status
    : null;
  const periodEnd = sub?.currentPeriodEnd
    ? formatDate(sub.currentPeriodEnd, locale)
    : null;

  return (
    <div className="space-y-6">
      {backLink}

      {/* ── profile header ── */}
      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar className="h-14 w-14">
            <AvatarImage src={user.image || undefined} alt={displayName} />
            <AvatarFallback className="text-lg">
              {(displayName?.[0] || "?").toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xl font-semibold tracking-tight">
                {displayName}
              </span>
              <Badge variant="secondary" className="capitalize">
                {user.role || "user"}
              </Badge>
              <Badge variant="outline">
                {user.emailVerified
                  ? t("detail.profile.verified")
                  : t("detail.profile.unverified")}
              </Badge>
              {user.banned && (
                <Badge variant="destructive">{t("detail.profile.banned")}</Badge>
              )}
            </div>
            <CopyText
              value={user.email}
              className="block truncate text-sm text-muted-foreground"
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>
                {t("detail.profile.joined")}:{" "}
                {formatDate(user.createdAt, locale)}
              </span>
              <span className="flex items-center gap-1">
                {t("detail.profile.stripeCustomer")}:{" "}
                {user.stripeCustomerId ? (
                  <CopyText
                    value={user.stripeCustomerId}
                    className="font-mono text-xs"
                  />
                ) : (
                  "-"
                )}
              </span>
            </div>
            {user.banned && user.banReason && (
              <p className="text-sm text-destructive">{user.banReason}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── stat cards: balance / subscription / lifetime ── */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Coins className="size-4 text-primary" />
              {t("detail.balance.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex h-full flex-col">
            <p className="text-4xl font-bold tracking-tight tabular-nums">
              {formatNumber(billing.totalCredits, locale)}
            </p>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {t("detail.balance.subscription")}
                </span>
                <span className="font-medium tabular-nums">
                  {formatNumber(billing.subscriptionCredits, locale)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {t("detail.balance.purchased")}
                </span>
                <span className="font-medium tabular-nums">
                  {formatNumber(billing.purchasedCredits, locale)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t pt-2 font-medium">
                <span>{t("detail.balance.total")}</span>
                <span className="tabular-nums">
                  {formatNumber(billing.totalCredits, locale)}
                </span>
              </div>
            </div>
            <div className="mt-auto pt-6">
              <AdjustCreditsButton
                userId={user.id}
                userEmail={user.email || user.id}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <CreditCard className="size-4 text-primary" />
              {t("detail.subscription.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex h-full flex-col">
            {sub ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-2xl font-bold tracking-tight">
                    {planName}
                  </span>
                  <Badge variant="secondary">
                    {t(`detail.subscription.interval.${sub.interval}`)}
                  </Badge>
                  <Badge
                    variant={
                      sub.status === "active" || sub.status === "trialing"
                        ? "default"
                        : "destructive"
                    }
                  >
                    {statusLabel}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("detail.subscription.monthlyCredits", {
                    credits: formatNumber(sub.monthlyCredits, locale),
                  })}
                </p>
                <div className="mt-4 space-y-2 text-sm">
                  {periodEnd && (
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <CalendarClock className="size-4" />
                      {sub.cancelAtPeriodEnd
                        ? t("detail.subscription.endsOn", { date: periodEnd })
                        : t("detail.subscription.renewsOn", {
                            date: periodEnd,
                          })}
                    </p>
                  )}
                  {sub.nextGrantAt && (
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <Coins className="size-4" />
                      {t("detail.subscription.nextGrant", {
                        date: formatDate(sub.nextGrantAt, locale),
                      })}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("detail.subscription.none")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <TrendingUp className="size-4 text-primary" />
              {t("detail.lifetime.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">
                  {t("detail.lifetime.orders")}
                </dt>
                <dd className="font-medium tabular-nums">
                  {formatNumber(lifetime.ordersCount, locale)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">
                  {t("detail.lifetime.netRevenue")}
                </dt>
                <dd className="font-medium tabular-nums">
                  {/* Lifetime net revenue aggregates across currencies — there is no
                      single currency, so only the number is shown, to two decimals */}
                  {formatNumber(lifetime.netRevenueCents / 100, locale, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">
                  {t("detail.lifetime.creditsConsumed")}
                </dt>
                <dd className="font-medium tabular-nums">
                  {formatNumber(lifetime.creditsConsumed, locale)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* ── ledger + orders history ── */}
      <UserHistoryTabs userId={user.id} />
    </div>
  );
}
