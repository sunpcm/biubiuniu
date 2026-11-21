/**
 * [INPUT]: Depends on @/actions/team for getTeamOverview, @/actions/billing/
 *          checkout for createCheckoutSession (the ?plan= round trip) and
 *          @/actions/billing/portal for createCustomerPortalSession (the
 *          purchaser's Manage button), @/config/pricing for getPlanName,
 *          @/lib/auth/auth-client for useActiveOrganization/useActiveMember,
 *          @/lib/format for formatNumber/formatDate, @tanstack/react-query,
 *          ./TeamMembersCard and ./TeamActivityCard
 * [OUTPUT]: Exports the TeamDashboard client component
 * [POS]: The active-organization view of dashboard/(user)/team — orchestrates
 *        four cards: subscription card + shared credit pool card (this file) +
 *        members/seats card + team activity card (child components); the ?plan=
 *        round-trip entry places the team checkout automatically once the owner
 *        role is confirmed (param stripped first so it fires once); the
 *        page-level refresh button refetches every data source, and the members
 *        card reuses the two-source refresh via onRefresh
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { createCheckoutSession } from "@/actions/billing/checkout";
import { createCustomerPortalSession } from "@/actions/billing/portal";
import { getTeamOverview } from "@/actions/team";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PRICING_PATH } from "@/config/public-paths";
import { getPlanName } from "@/config/pricing";
import { Link as I18nLink, useRouter } from "@/i18n/routing";
import { authClient } from "@/lib/auth/auth-client";
import { formatDate, formatNumber } from "@/lib/format";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Coins,
  CreditCard,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { TeamActivityCard } from "./TeamActivityCard";
import { TeamMembersCard } from "./TeamMembersCard";

// ----------------------------------------------------------------------------
// Self-serve subscription management — the team subscription lives on the
// purchaser's provider customer, so only the purchaser sees this entry. One
// click opens the provider portal (the portal action resolves the live team
// subscription from the active workspace and dispatches per provider).
// ----------------------------------------------------------------------------

function ManageTeamSubscriptionButton() {
  const t = useTranslations("Team");
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      const result = await createCustomerPortalSession();
      if (result.success && result.data?.url) {
        window.location.href = result.data.url;
        return; // keep the spinner while the browser navigates
      }
      toast.error(!result.success ? result.error : t("page.subscription.manageFailed"));
    } catch {
      toast.error(t("page.subscription.manageFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant="outline" size="sm" disabled={loading} onClick={handleClick}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
      {t("page.subscription.manage")}
    </Button>
  );
}

// ----------------------------------------------------------------------------
// Dashboard body
// ----------------------------------------------------------------------------

export function TeamDashboard({
  organizationId,
  currentUserId,
  planId,
}: {
  organizationId: string;
  currentUserId: string;
  /** ?plan= round-trip: the pricing page sent the owner here to create the team first; checkout resumes automatically */
  planId: string | null;
}) {
  const t = useTranslations("Team");
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: activeOrg, refetch: refetchActiveOrg } = authClient.useActiveOrganization();
  const { data: activeMember } = authClient.useActiveMember();

  // Failures MUST throw: swallowing errors and returning null would be cached
  // by react-query as successful data — no retry, skeleton spins forever.
  // Throwing routes it through the retry and isError channels.
  const {
    data: overview,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["team-overview", organizationId],
    queryFn: async () => {
      const result = await getTeamOverview(organizationId);
      if (!result.success) {
        throw new Error(result.error || "Failed to load team overview");
      }
      if (!result.data) {
        throw new Error("Failed to load team overview");
      }
      return result.data;
    },
  });

  // Manual refresh: the members card has two sources (activeOrg members/
  // invitations + overview seats/subscription); the page level adds the team
  // activity ledger on top (partial key match hits every page).
  const refreshMembersData = () =>
    Promise.all([
      refetchActiveOrg(),
      queryClient.invalidateQueries({
        queryKey: ["team-overview", organizationId],
      }),
    ]);

  const [refreshingAll, setRefreshingAll] = useState(false);
  const handleRefreshAll = async () => {
    if (refreshingAll) return;
    setRefreshingAll(true);
    try {
      await Promise.all([
        refreshMembersData(),
        queryClient.invalidateQueries({
          queryKey: ["team-credit-history", organizationId],
        }),
      ]);
    } finally {
      setRefreshingAll(false);
    }
  };

  // ?plan= round-trip: the pricing page sent the owner here to create a team
  // first. Wait for activeMember to confirm the owner role, then place the
  // order exactly once. The param is stripped before checkout starts, so a
  // reload or back-navigation lands on a clean /dashboard/team and cannot
  // fire it again (same route segment: the component stays mounted and the
  // ref survives the replace).
  const checkoutFired = useRef(false);
  useEffect(() => {
    if (!planId || checkoutFired.current || !activeMember) return;
    checkoutFired.current = true;
    router.replace("/dashboard/team");

    if (activeMember.role !== "owner") {
      toast.error(t("page.checkout.ownerOnly"));
      return;
    }

    (async () => {
      try {
        const result = await createCheckoutSession({
          planId,
          organizationId,
          toltReferral: (window as { tolt_referral?: string }).tolt_referral,
        });
        if (result.success && result.data?.url) {
          window.location.href = result.data.url;
          return;
        }
        toast.error(
          !result.success && result.customCode === "SUBSCRIPTION_EXISTS"
            ? t("page.checkout.exists")
            : t("page.checkout.failed"),
        );
      } catch {
        toast.error(t("page.checkout.failed"));
      }
    })();
  }, [planId, activeMember, organizationId, router, t]);

  if (isError) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-muted-foreground text-sm">{t("page.loadError")}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          {t("page.retry")}
        </Button>
      </div>
    );
  }

  if (isLoading || !overview) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
        </div>
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const sub = overview.billing.subscription;
  const planName = sub ? getPlanName(sub.planId, locale) : null;
  const statusLabel = sub
    ? t.has(`page.subscription.status.${sub.status}`)
      ? t(`page.subscription.status.${sub.status}`)
      : sub.status
    : null;
  const periodEnd = sub?.currentPeriodEnd ? formatDate(sub.currentPeriodEnd, locale) : null;

  return (
    <div className="space-y-4">
      {/* Page-level refresh: refetch every data source on this page
          (members/invitations + overview + team activity) */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="icon"
          className="text-muted-foreground size-8"
          title={t("page.refresh")}
          aria-label={t("page.refresh")}
          disabled={refreshingAll}
          onClick={handleRefreshAll}
        >
          <RefreshCw className={refreshingAll ? "size-4 animate-spin" : "size-4"} />
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Subscription card */}
        <Card className="gap-3 py-5">
          <CardHeader>
            <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
              <CreditCard className="text-primary size-4" />
              {t("page.subscription.title")}
            </CardTitle>
            <CardAction>
              {sub ? (
                overview.isSubscriptionPurchaser && <ManageTeamSubscriptionButton />
              ) : (
                <Button asChild size="sm">
                  <I18nLink href={PRICING_PATH}>
                    <Sparkles className="size-3.5" />
                    {t("page.subscription.viewPlans")}
                  </I18nLink>
                </Button>
              )}
            </CardAction>
          </CardHeader>
          <CardContent>
            {sub ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-2xl leading-none font-bold tracking-tight">{planName}</span>
                  <Badge variant="secondary">
                    {t(`page.subscription.interval.${sub.interval}`)}
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
                <p className="text-muted-foreground mt-2 text-sm">
                  {t("page.subscription.monthlyCredits", {
                    credits: formatNumber(sub.monthlyCredits, locale),
                  })}
                </p>
                {periodEnd && (
                  <p className="text-muted-foreground mt-3 flex items-center gap-2 text-sm">
                    <CalendarClock className="size-4 shrink-0" />
                    {sub.cancelAtPeriodEnd
                      ? t("page.subscription.endsOn", { date: periodEnd })
                      : t("page.subscription.renewsOn", { date: periodEnd })}
                  </p>
                )}
                {!overview.isSubscriptionPurchaser && (
                  <p className="text-muted-foreground mt-3 text-xs">
                    {t("page.subscription.purchaserOnly")}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-lg leading-none font-semibold">
                  {t("page.subscription.noPlan")}
                </p>
                <p className="text-muted-foreground mt-2 text-sm">
                  {t("page.subscription.noPlanDescription")}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Shared credit pool card */}
        <Card className="gap-3 py-5">
          <CardHeader>
            <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
              <Coins className="text-primary size-4" />
              {t("page.pool.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl leading-none font-bold tracking-tight tabular-nums">
              {formatNumber(overview.billing.totalCredits, locale)}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="flex items-baseline gap-1.5">
                <span className="text-muted-foreground">{t("page.pool.subscription")}</span>
                <span className="font-semibold tabular-nums">
                  {formatNumber(overview.billing.subscriptionCredits, locale)}
                </span>
              </span>
              <span className="bg-border hidden h-3.5 w-px sm:inline-block" />
              <span className="flex items-baseline gap-1.5">
                <span className="text-muted-foreground">{t("page.pool.purchased")}</span>
                <span className="font-semibold tabular-nums">
                  {formatNumber(overview.billing.purchasedCredits, locale)}
                </span>
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Members & seats card */}
      <TeamMembersCard
        organizationId={organizationId}
        currentUserId={currentUserId}
        currentRole={activeMember?.role}
        seats={overview.seats}
        hasTeamSubscription={overview.hasTeamSubscription}
        members={activeOrg?.members ?? []}
        invitations={activeOrg?.invitations ?? []}
        onMutated={() =>
          queryClient.invalidateQueries({
            queryKey: ["team-overview", organizationId],
          })
        }
        onRefresh={refreshMembersData}
      />

      {/* Team activity card */}
      <TeamActivityCard organizationId={organizationId} />
    </div>
  );
}
