/**
 * [INPUT]: Depends on @/actions/billing/portal for createCustomerPortalSession,
 *          @/components/ui/button, sonner for toast
 * [OUTPUT]: Exports the ManageSubscriptionButton component (optional size prop
 *          to fit a compact header)
 * [POS]: The subscription self-service button of dashboard/(user)/billing —
 *        consumed by page.tsx; the portal action dispatches per provider
 *        internally: stripe -> Billing Portal, creem -> Creem Portal,
 *        paypal -> the PayPal autopay page
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { createCustomerPortalSession } from "@/actions/billing/portal";
import { Button } from "@/components/ui/button";
import { ExternalLink, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

export function ManageSubscriptionButton({
  size = "default",
}: {
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  const t = useTranslations("Billing");
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      const result = await createCustomerPortalSession();
      if (result.success && result.data?.url) {
        window.location.href = result.data.url;
        return; // keep the spinner while the browser navigates
      }
      toast.error(!result.success ? result.error : t("plan.manageFailed"));
    } catch {
      toast.error(t("plan.manageFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size={size}
      disabled={loading}
      onClick={handleClick}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <ExternalLink className="size-4" />
      )}
      {t("plan.manage")}
    </Button>
  );
}
