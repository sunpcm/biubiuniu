import PricingCTA from "@/components/pricing/PricingCTA";
import { pricingPlans as pricingPlansSchema } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import { PricingPlanFeature, PricingPlanTranslation } from "@/types/pricing";
import { Check, X } from "lucide-react";

type PricingPlan = typeof pricingPlansSchema.$inferSelect;

interface PricingCardDisplayProps {
  id?: string;
  plan: PricingPlan;
  localizedPlan: PricingPlanTranslation;
}

export function PricingCardDisplay({ id, plan, localizedPlan }: PricingCardDisplayProps) {
  const cardTitle = localizedPlan?.cardTitle || plan.cardTitle || "Unnamed Plan";
  const cardDescription = localizedPlan?.cardDescription || plan.cardDescription || "";
  const displayPrice = localizedPlan?.displayPrice || plan.displayPrice || "";
  const originalPrice = localizedPlan?.originalPrice || plan.originalPrice;
  const priceSuffix =
    localizedPlan?.priceSuffix?.replace(/^\/+/, "") || plan.priceSuffix?.replace(/^\/+/, "");
  const features = localizedPlan?.features || plan.features || [];
  const highlightText = localizedPlan?.highlightText;

  return (
    <div
      id={id}
      className={cn(
        "rounded-xl border border-t-4 shadow-xs",
        "border-gray-300 dark:border-gray-600",
        "hover:border-primary dark:hover:border-primary transition-all duration-300 hover:scale-105 hover:shadow-xl",
        plan.isHighlighted
          ? "border-primary dark:border-primary relative z-10 -my-4 px-8 py-12"
          : "p-8",
      )}
    >
      {plan.isHighlighted && highlightText && (
        <div
          className={cn(
            "bg-primary text-primary-foreground absolute -top-px right-0 rounded-tr-lg rounded-bl-lg px-3 py-1 text-xs font-medium",
          )}
        >
          {highlightText}
        </div>
      )}
      <h3 className="mb-2 text-2xl font-semibold">{cardTitle}</h3>
      {cardDescription && <p className="text-muted-foreground mb-6 h-12">{cardDescription}</p>}

      <PricingCTA plan={plan} localizedPlan={localizedPlan} />

      <div className="mb-6 text-4xl">
        {originalPrice ? (
          <span className="text-muted-foreground mr-1 text-sm line-through decoration-2">
            {originalPrice}
          </span>
        ) : null}

        {displayPrice}

        {priceSuffix ? <span className="text-muted-foreground text-sm">/{priceSuffix}</span> : null}
      </div>
      <ul className="mb-6 space-y-3">
        {(features as PricingPlanFeature[])?.map(
          (feature: { description: string; included: boolean; bold?: boolean }, index: number) => (
            <li key={index} className="flex items-start">
              {feature.included ? (
                <Check className="mt-1 mr-3 h-5 w-5 shrink-0 text-green-500" />
              ) : (
                <X className="mt-1 mr-3 h-5 w-5 shrink-0 text-red-500 opacity-50" />
              )}
              <span
                className={cn(
                  feature.included ? "" : "opacity-50",
                  feature.bold ? "font-bold" : "",
                )}
              >
                {feature.description}
              </span>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
