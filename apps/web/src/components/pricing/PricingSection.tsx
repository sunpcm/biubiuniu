/**
 * [INPUT]: Depends on @/config/pricing for activePricingPlans/isSubscriptionPlan/isTeamPlan,
 *          @/components/ui/tabs, lucide-react for Users,
 *          next-intl/server for getTranslations, ./PricingCard
 * [OUTPUT]: Exports the PricingSection server component
 * [POS]: The entry point of components/pricing — render root of the home page
 *        and the pricing anchor (#pricing), three tabs: monthly subscriptions /
 *        yearly subscriptions / credit packs; inside the monthly and yearly
 *        tabs a team-tier section is embedded below the personal-tier grid
 *        (Pricing.teamSection, 2 columns, centered)
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  activePricingPlans,
  isSubscriptionPlan,
  isTeamPlan,
  type PricingPlan,
} from "@/config/pricing";
import { isPurchaseEnabled } from "@/config/features";
import { Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { PricingCard } from "./PricingCard";

/**
 * Subscription tab content: personal plans grid, with a team subsection
 * below when team plans of the matching interval exist (shared pool +
 * seats pitch). Team plans live inside the interval tabs — never a
 * separate audience tab.
 */
function SubscriptionGrid({
  personalPlans,
  teamPlans,
  teamTitle,
  teamSubtitle,
}: {
  personalPlans: PricingPlan[];
  teamPlans: PricingPlan[];
  teamTitle: string;
  teamSubtitle: string;
}) {
  return (
    <>
      <div className="mx-auto grid max-w-3xl gap-6 pt-4 md:grid-cols-2">
        {personalPlans.map((plan) => (
          <PricingCard key={plan.id} plan={plan} />
        ))}
      </div>
      {teamPlans.length > 0 && (
        <div className="mx-auto mt-14 max-w-6xl">
          <div className="mb-8 space-y-2 text-center">
            <h3 className="flex items-center justify-center gap-2 text-xl font-semibold tracking-tight md:text-2xl">
              <Users className="size-5 text-primary" />
              {teamTitle}
            </h3>
            <p className="text-sm text-muted-foreground">{teamSubtitle}</p>
          </div>
          <div className="mx-auto grid max-w-3xl gap-6 md:grid-cols-2">
            {teamPlans.map((plan) => (
              <PricingCard key={plan.id} plan={plan} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export async function PricingSection() {
  const t = await getTranslations("Pricing");

  if (!isPurchaseEnabled()) {
    return (
      <section id="pricing" className="py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {t("title")}
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              {t("purchaseDisabled")}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const monthlyPlans = activePricingPlans.filter(
    (plan) =>
      isSubscriptionPlan(plan) && !isTeamPlan(plan) && plan.interval === "month"
  );
  const yearlyPlans = activePricingPlans.filter(
    (plan) =>
      isSubscriptionPlan(plan) && !isTeamPlan(plan) && plan.interval === "year"
  );
  const teamMonthlyPlans = activePricingPlans.filter(
    (plan) => isTeamPlan(plan) && plan.interval === "month"
  );
  const teamYearlyPlans = activePricingPlans.filter(
    (plan) => isTeamPlan(plan) && plan.interval === "year"
  );
  const creditPacks = activePricingPlans.filter(
    (plan) => !isSubscriptionPlan(plan)
  );

  return (
    <section id="pricing" className="py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold tracking-wide text-primary">
            {t("badge.label")}
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            {t("title")}
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            {t("description")}
          </p>
        </div>

        {/* Plan groups */}
        <Tabs defaultValue="yearly" className="mt-10">
          <TabsList className="mx-auto flex w-fit">
            <TabsTrigger value="monthly">{t("tabs.monthly")}</TabsTrigger>
            <TabsTrigger value="yearly">
              {t("tabs.yearly")}
              <span className="ml-1.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                {t("saveTip")}
              </span>
            </TabsTrigger>
            <TabsTrigger value="packs">{t("tabs.packs")}</TabsTrigger>
          </TabsList>

          <TabsContent value="monthly" className="mt-10">
            <SubscriptionGrid
              personalPlans={monthlyPlans}
              teamPlans={teamMonthlyPlans}
              teamTitle={t("teamSection.title")}
              teamSubtitle={t("teamSection.subtitle")}
            />
          </TabsContent>

          <TabsContent value="yearly" className="mt-10">
            <SubscriptionGrid
              personalPlans={yearlyPlans}
              teamPlans={teamYearlyPlans}
              teamTitle={t("teamSection.title")}
              teamSubtitle={t("teamSection.subtitle")}
            />
          </TabsContent>

          <TabsContent value="packs" className="mt-10">
            <div className="mx-auto grid max-w-5xl gap-6 pt-4 md:grid-cols-3">
              {creditPacks.map((plan) => (
                <PricingCard key={plan.id} plan={plan} />
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
