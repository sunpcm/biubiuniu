/**
 * [INPUT]: Depends on createCheckoutSession from @/actions/billing/checkout,
 *          useRouter from @/i18n/routing, @/components/ui/button, toast from sonner
 * [OUTPUT]: Exports the CheckoutButton component
 * [POS]: The unified purchase entry point of components/pricing — consumed by PricingCard,
 *        shared by subscriptions and credit packs (except PayPal credit packs, which go
 *        through PayPalCheckoutButton);
 *        signed-out users go to /login, success navigates to the provider Checkout /
 *        approval page;
 *        a team plan without an organization (ORGANIZATION_REQUIRED) goes to
 *        /dashboard/team?plan= — once the team exists, TeamDashboard calls
 *        createCheckoutSession({ planId, organizationId }) itself and hands
 *        the owner to the provider checkout (no second trip through here);
 *        buying a credit pack in a team workspace (TEAM_WORKSPACE_CREDIT_PACK) prompts
 *        a switch back to the personal workspace
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { createCheckoutSession } from "@/actions/billing/checkout";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/routing";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

interface CheckoutButtonProps {
  planId: string;
  label: string;
  popular?: boolean;
}

export function CheckoutButton({ planId, label, popular }: CheckoutButtonProps) {
  const t = useTranslations("Pricing");
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    setLoading(true);
    try {
      const result = await createCheckoutSession({
        planId,
        // Affiliate attribution set by the Tolt script, when present.
        toltReferral:
          typeof window !== "undefined"
            ? (window as { tolt_referral?: string }).tolt_referral
            : undefined,
      });

      if (result.success && result.data?.url) {
        window.location.href = result.data.url;
        return; // keep the spinner while the browser navigates
      }

      if (!result.success && result.customCode === "UNAUTHORIZED") {
        router.push("/login");
        return;
      }

      if (!result.success && result.customCode === "SUBSCRIPTION_EXISTS") {
        toast.info(t("subscriptionExists"));
        router.push("/dashboard/billing");
        return;
      }

      // Credit packs only fill the personal purchased bucket — team
      // workspaces can't buy them. Prompt a switch back to personal.
      if (
        !result.success &&
        result.customCode === "TEAM_WORKSPACE_CREDIT_PACK"
      ) {
        toast.info(t("creditPackPersonalOnly"));
        return;
      }

      // Team plan but the server couldn't resolve an organization (no owned
      // org, or several and the active workspace points at none of them):
      // go create/pick a team; ?plan= flows back and resumes checkout.
      if (!result.success && result.customCode === "ORGANIZATION_REQUIRED") {
        toast.info(t("teamOrgRequired"));
        router.push(`/dashboard/team?plan=${planId}`);
        return;
      }

      toast.error(
        !result.success ? result.error : t("checkoutFailed")
      );
    } catch {
      toast.error(t("checkoutFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      className="w-full"
      size="lg"
      variant={popular ? "default" : "outline"}
      disabled={loading}
      onClick={handleCheckout}
    >
      {loading ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          {t("processing")}
        </>
      ) : (
        label
      )}
    </Button>
  );
}
