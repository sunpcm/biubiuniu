"use client";

import { Button } from "@niu/ui/button";
import { DEFAULT_LOCALE, useRouter } from "@/i18n/routing";
import { pricingPlans as pricingPlansSchema } from "@/lib/db/schema";
import { Loader2, MousePointerClick } from "lucide-react";
import { useLocale } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

type PricingPlan = typeof pricingPlansSchema.$inferSelect;

type Params = {
  plan: PricingPlan;
  localizedPlan: any;
};

export default function PricingCTA({ plan, localizedPlan }: Params) {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const locale = useLocale();

  const provider = plan.provider;
  const isCreem = provider === "creem";
  const isStripe = provider === "stripe";

  const handleCheckout = async (applyCoupon = true) => {
    const stripePriceId = plan.stripePriceId ?? null;
    if (isStripe && !stripePriceId) {
      toast.error("Stripe price ID is missing for this plan.");
      return;
    }

    const creemProductId = plan.creemProductId ?? null;
    if (isCreem && !creemProductId) {
      toast.error("Creem product ID is missing for this plan.");
      return;
    }

    setIsLoading(true);
    try {
      const requestBody: {
        provider: string;
        couponCode?: string;
        // Stripe
        stripePriceId?: string;
        referral?: string;

        // Creem
        creemProductId?: string;
      } = {
        provider: provider || "stripe",
      };

      if (isStripe) {
        requestBody.stripePriceId = stripePriceId!;
        requestBody.couponCode =
          applyCoupon && plan.stripeCouponId ? plan.stripeCouponId : undefined;

        const toltReferral = (window as any).tolt_referral;
        requestBody.referral = toltReferral ?? undefined;
      }
      if (isCreem) {
        requestBody.creemProductId = creemProductId!;
        requestBody.couponCode =
          applyCoupon && plan.creemDiscountCode ? plan.creemDiscountCode : undefined;
      }

      const response = await fetch("/api/payment/checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept-Language": (locale || DEFAULT_LOCALE) as string,
        },
        body: JSON.stringify(requestBody),
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          router.push("/login");
          toast.error("You must be logged in to purchase a plan.");
          return;
        }
        throw new Error(result.error || "HTTP error! status: " + response.status);
      }

      if (!result.success) {
        throw new Error(result.error || "Failed to create checkout session.");
      }

      const data = result.data;

      if (data.url) {
        router.push(data.url);
        setIsLoading(false);
      } else {
        throw new Error("Checkout URL not received.");
      }
    } catch (error) {
      console.error("Checkout Error:", error);
      toast.error(error instanceof Error ? error.message : "An unexpected error occurred.");
      setIsLoading(false);
    }
  };

  let defaultCouponCode = null;
  if (isCreem) {
    defaultCouponCode = plan.creemDiscountCode;
  } else if (isStripe) {
    defaultCouponCode = plan.stripeCouponId;
  }

  const allowManualCoupon = Boolean(defaultCouponCode) && plan.enableManualInputCoupon;

  return (
    <div>
      <Button
        asChild={!!plan.buttonLink}
        disabled={isLoading}
        className={`flex w-full items-center justify-center gap-2 py-5 font-medium ${
          plan.isHighlighted
            ? ""
            : "bg-gray-900 text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
        } ${allowManualCoupon ? "mb-2" : "mb-6"}`}
        {...(!plan.buttonLink && {
          onClick: () => handleCheckout(),
        })}
      >
        {plan.buttonLink ? (
          <Link
            href={plan.buttonLink}
            title={localizedPlan.buttonText || plan.buttonText}
            rel="noopener noreferrer nofollow"
            target="_blank"
            prefetch={false}
          >
            {localizedPlan.buttonText || plan.buttonText}
            {plan.isHighlighted && <MousePointerClick className="h-5 w-5" />}
          </Link>
        ) : (
          <>
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              localizedPlan.buttonText || plan.buttonText
            )}
            {plan.isHighlighted && !isLoading && <MousePointerClick className="ml-2 h-5 w-5" />}
          </>
        )}
      </Button>
      {allowManualCoupon && (
        <div className="mb-2 text-center">
          <button
            onClick={() => handleCheckout(false)}
            disabled={isLoading}
            className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-2 transition-colors disabled:opacity-50"
          >
            I have a different coupon code
          </button>
        </div>
      )}
    </div>
  );
}
