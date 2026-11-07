/**
 * [INPUT]: Depends on @/config/pricing's PricingPlan/PlanFeature types and
 *          isSubscriptionPlan/getPlanCredits/getPlanCopy, next-intl's
 *          useTranslations/useLocale, ./CheckoutButton, ./PayPalCheckoutButton
 * [OUTPUT]: Exports the PricingCard component (feature rows support inline
 *          **bold** markers plus a highlight text-color lift: row in
 *          foreground + bold segments in primary, no background block —
 *          the visual stage for team-exclusive perks)
 * [POS]: The card renderer of components/pricing — consumed by PricingSection;
 *        plan copy and numbers all come from config/pricing (copy inlined for
 *        en/zh/ja), i18n only carries section-level UI strings; CTA fork:
 *        paypal credit packs render PayPalCheckoutButton (client-side PayPal
 *        buttons), everything else goes through CheckoutButton
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import {
  getPlanCopy,
  getPlanCredits,
  isSubscriptionPlan,
  type PlanFeature,
  type PricingPlan,
} from "@/config/pricing";
import { cn } from "@/lib/utils";
import { Check, Coins, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { CheckoutButton } from "./CheckoutButton";
import { PayPalCheckoutButton } from "./PayPalCheckoutButton";

function formatPrice(locale: string, amount: number, currency: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// ============================================================
// Feature copy supports inline **bold** markers (odd segments
// after split are the bold ones). Emphasis is pure text color —
// no background blocks: muted row / foreground bold by default;
// a `highlight` row goes foreground with primary bold segments,
// echoing the Check icon. Reserved for team-exclusive perks.
// ============================================================
function FeatureText({
  text,
  boldClassName,
}: {
  text: string;
  boldClassName: string;
}) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <strong key={index} className={cn("font-semibold", boldClassName)}>
            {part}
          </strong>
        ) : (
          part
        )
      )}
    </>
  );
}

function FeatureRow({ feature }: { feature: PlanFeature }) {
  const { text, highlight = false } =
    typeof feature === "string" ? { text: feature } : feature;
  return (
    <li className="flex items-start gap-2 text-sm">
      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
      <span className={highlight ? "text-foreground" : "text-muted-foreground"}>
        <FeatureText
          text={text}
          boldClassName={highlight ? "text-primary" : "text-foreground"}
        />
      </span>
    </li>
  );
}

export function PricingCard({ plan }: { plan: PricingPlan }) {
  const t = useTranslations("Pricing");
  const locale = useLocale();

  const isSubscription = isSubscriptionPlan(plan);
  const credits = getPlanCredits(plan);
  const copy = getPlanCopy(plan, locale);
  const creditsFormatted = new Intl.NumberFormat(locale).format(credits);

  // PayPal one-time credit packs render client-side PayPal buttons — the
  // order is created dynamically from the plan, no provider price ref, no
  // server-side redirect. Every other plan (incl. PayPal subscriptions,
  // which return an approval URL) goes through the shared CheckoutButton.
  const usePayPalButtons = plan.provider === "paypal" && !isSubscription;

  return (
    <div
      className={cn(
        "relative flex h-full flex-col rounded-2xl border bg-card p-6 text-card-foreground shadow-sm transition-shadow hover:shadow-md",
        plan.popular && "border-primary shadow-lg shadow-primary/10"
      )}
    >
      {/* Popular ribbon */}
      {plan.popular && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm">
            <Sparkles className="size-3" />
            {t("popular")}
          </span>
        </div>
      )}

      {/* Name + description */}
      <div className="space-y-1.5">
        <h3 className="text-lg font-semibold">{copy.name}</h3>
        <p className="text-sm text-muted-foreground">{copy.description}</p>
      </div>

      {/* Price */}
      <div className="mt-5 flex items-baseline gap-2">
        <span className="text-4xl font-bold tracking-tight">
          {formatPrice(locale, plan.price, plan.currency)}
        </span>
        {plan.originalPrice && (
          <span className="text-base text-muted-foreground line-through">
            {formatPrice(locale, plan.originalPrice, plan.currency)}
          </span>
        )}
        {isSubscription && (
          <span className="text-sm text-muted-foreground">
            {plan.interval === "year" ? t("perYear") : t("perMonth")}
          </span>
        )}
      </div>

      {/* Credits highlight */}
      <div className="mt-4 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2.5">
        <Coins className="size-4 shrink-0 text-primary" />
        <span className="text-sm font-medium">
          {isSubscription
            ? t("creditsPerMonth", { credits: creditsFormatted })
            : t("creditsOneTime", { credits: creditsFormatted })}
        </span>
      </div>
      {!isSubscription && (
        <p className="mt-2 text-xs text-muted-foreground">{t("packNote")}</p>
      )}

      {/* Features */}
      <ul className="mt-5 flex-1 space-y-2.5">
        {copy.features.map((feature) => (
          <FeatureRow
            key={typeof feature === "string" ? feature : feature.text}
            feature={feature}
          />
        ))}
      </ul>

      {/* CTA */}
      <div className="mt-6">
        {usePayPalButtons ? (
          <PayPalCheckoutButton plan={plan} />
        ) : (
          <CheckoutButton
            planId={plan.id}
            popular={plan.popular}
            label={isSubscription ? t("subscribe") : t("buy")}
          />
        )}
      </div>
    </div>
  );
}
