/**
 * [INPUT]: Depends on getSession/getWorkspaceContext from @/lib/auth/server,
 *          getUserBillingSummary from @/lib/credits, getPlanName from
 *          @/config/pricing, formatNumber/formatDate from @/lib/format,
 *          constructMetadata from @/lib/metadata,
 *          ./ManageSubscriptionButton, ./BillingHistory, ./NextRefreshTime
 *          (local + UTC rendering of the next grant), next-intl/server
 * [OUTPUT]: Exports the BillingPage server component and generateMetadata
 * [POS]: The entry point of dashboard/(user)/billing — the only personal billing
 *        page on the user side: dual-bucket credit balance + current plan +
 *        purchase/credit history; when the active workspace is a team, a notice
 *        bar at the top links to /dashboard/team (the team pool and the team
 *        subscription are managed on the team page)
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PRICING_PATH } from "@/config/public-paths";
import { getPlanName } from "@/config/pricing";
import { Link as I18nLink, Locale } from "@/i18n/routing";
import { getSession, getWorkspaceContext } from "@/lib/auth/server";
import { getUserBillingSummary } from "@/lib/credits";
import { formatDate, formatNumber } from "@/lib/format";
import { constructMetadata } from "@/lib/metadata";
import { CalendarClock, Coins, CreditCard, Sparkles, Users } from "lucide-react";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { BillingHistory } from "./BillingHistory";
import { ManageSubscriptionButton } from "./ManageSubscriptionButton";
import { NextRefreshTime } from "./NextRefreshTime";

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Billing" });

  return constructMetadata({
    title: t("title"),
    description: t("description"),
    locale: locale as Locale,
    path: "/dashboard/billing",
  });
}

export default async function BillingPage({ params }: { params: Params }) {
  const session = await getSession();
  if (!session?.user) {
    redirect("/login");
  }

  const { locale } = await params;
  const [summary, t] = await Promise.all([
    getUserBillingSummary(session.user.id),
    getTranslations("Billing"),
  ]);

  const sub = summary.subscription;
  const planName = sub ? getPlanName(sub.planId, locale) : null;
  const statusLabel = sub
    ? t.has(`plan.status.${sub.status}`)
      ? t(`plan.status.${sub.status}`)
      : sub.status
    : null;
  const periodEnd = sub?.currentPeriodEnd ? formatDate(sub.currentPeriodEnd, locale) : null;

  // In a team workspace this page still shows personal billing — the team
  // pool and team subscription are managed on the team page. Say so up top.
  const workspace = await getWorkspaceContext();
  const inTeamWorkspace = !!workspace?.organizationId;

  return (
    <div className="space-y-4">
      {inTeamWorkspace && (
        <div className="border-primary/20 bg-primary/5 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm">
          <Users className="text-primary size-4 shrink-0" />
          <span>{t("teamWorkspaceNotice")}</span>
          <Button asChild size="sm" variant="link" className="ml-auto shrink-0">
            <I18nLink href="/dashboard/team">{t("teamWorkspaceCta")}</I18nLink>
          </Button>
        </div>
      )}
      {/* Top row: balance + current plan — compact, self-sizing cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Credit balance */}
        <Card className="gap-3 py-5">
          <CardHeader>
            <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
              <Coins className="text-primary size-4" />
              {t("balance.title")}
            </CardTitle>
            <CardAction>
              <Button asChild size="sm">
                <I18nLink href={PRICING_PATH}>
                  <Sparkles className="size-3.5" />
                  {t("balance.buyMore")}
                </I18nLink>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <p className="text-3xl leading-none font-bold tracking-tight tabular-nums">
              {formatNumber(summary.totalCredits, locale)}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="flex items-baseline gap-1.5">
                <span className="text-muted-foreground">{t("balance.subscription")}</span>
                <span className="font-semibold tabular-nums">
                  {formatNumber(summary.subscriptionCredits, locale)}
                </span>
              </span>
              <span className="bg-border hidden h-3.5 w-px sm:inline-block" />
              <span className="flex items-baseline gap-1.5">
                <span className="text-muted-foreground">{t("balance.purchased")}</span>
                <span className="font-semibold tabular-nums">
                  {formatNumber(summary.purchasedCredits, locale)}
                </span>
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Current plan */}
        <Card className="gap-3 py-5">
          <CardHeader>
            <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
              <CreditCard className="text-primary size-4" />
              {t("plan.title")}
            </CardTitle>
            <CardAction>
              {sub ? (
                <ManageSubscriptionButton size="sm" />
              ) : (
                <Button asChild size="sm" variant="outline">
                  <I18nLink href={PRICING_PATH}>{t("plan.viewPlans")}</I18nLink>
                </Button>
              )}
            </CardAction>
          </CardHeader>
          <CardContent>
            {sub ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-2xl leading-none font-bold tracking-tight">{planName}</span>
                  <Badge variant="secondary">{t(`plan.interval.${sub.interval}`)}</Badge>
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
                <p className="text-muted-foreground mt-2 text-sm">
                  {t("plan.monthlyCredits", {
                    credits: formatNumber(sub.monthlyCredits, locale),
                  })}
                </p>
                <div className="mt-3 space-y-1.5 text-sm">
                  {periodEnd && (
                    <p className="text-muted-foreground flex items-center gap-2">
                      <CalendarClock className="size-4 shrink-0" />
                      {sub.cancelAtPeriodEnd
                        ? t("plan.endsOn", { date: periodEnd })
                        : t("plan.renewsOn", { date: periodEnd })}
                    </p>
                  )}
                  {/* Only annual plans drip monthly grants (nextGrantAt); a
                      monthly plan's next grant is the renewal date shown above */}
                  {sub.nextGrantAt && (
                    <p className="text-muted-foreground flex items-center gap-2">
                      <Coins className="size-4 shrink-0" />
                      <NextRefreshTime date={sub.nextGrantAt} />
                    </p>
                  )}
                  {sub.cancelAtPeriodEnd && periodEnd && (
                    <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-400">
                      {t("plan.cancelNotice", { date: periodEnd })}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="text-lg leading-none font-semibold">{t("plan.noPlan")}</p>
                <p className="text-muted-foreground mt-2 text-sm">{t("plan.noPlanDescription")}</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* History */}
      <BillingHistory />
    </div>
  );
}
