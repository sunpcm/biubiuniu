/**
 * [INPUT]: Depends on @/config/pricing for the CreditPackPlan type,
 *          @/lib/paypal/script-options for buildPayPalOptions,
 *          @paypal/react-paypal-js for PayPalScriptProvider/PayPalButtons,
 *          @/i18n/routing for useRouter, next-intl for useTranslations, sonner for toast
 * [OUTPUT]: Exports the PayPalCheckoutButton component
 * [POS]: The PayPal one-time payment entry of components/pricing — serves only
 *        credit packs with provider === 'paypal' (subscriptions go through CheckoutButton's approval-URL redirect);
 *        creates the order via POST /api/paypal/create-order { planId } (409 =
 *        credit packs are barred in a team workspace, toast tells the user to
 *        switch back to the personal workspace),
 *        then POST /api/paypal/capture-order { orderId } once the user approves,
 *        on success (pending included) navigates to /payment/success?provider=paypal&order_id=
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { Button } from "@/components/ui/button";
import type { CreditPackPlan } from "@/config/pricing";
import { useRouter } from "@/i18n/routing";
import { buildPayPalOptions } from "@/lib/paypal/script-options";
import {
  PayPalButtons,
  PayPalScriptProvider,
} from "@paypal/react-paypal-js";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

interface Props {
  plan: CreditPackPlan;
}

export function PayPalCheckoutButton({ plan }: Props) {
  const t = useTranslations("Pricing");
  const router = useRouter();
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;

  if (!clientId) {
    return (
      <Button disabled className="w-full">
        {t("paypalNotConfigured")}
      </Button>
    );
  }

  const options = buildPayPalOptions({
    currency: plan.currency || "USD",
    intent: "capture",
  });

  async function handleCreateOrder(): Promise<string> {
    try {
      // Ask the backend to create a one-time PayPal Order for this plan.
      const response = await fetch("/api/paypal/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        if (response.status === 401) {
          router.push("/login");
          toast.error(t("loginRequired"));
          throw new Error(result.error || "Unauthorized");
        }
        if (response.status === 409) {
          // Credit packs are barred in a team workspace (the same guard as
          // CheckoutButton's TEAM_WORKSPACE_CREDIT_PACK): tell the user to
          // switch back to the personal workspace.
          throw new Error(t("creditPackPersonalOnly"));
        }
        throw new Error(result.error || t("checkoutFailed"));
      }

      // Hand the orderId back to the PayPal SDK.
      return result.data.orderId;
    } catch (error) {
      console.error("[PayPal] Create order error:", error);
      const message =
        error instanceof Error ? error.message : t("checkoutFailed");
      toast.error(message);
      throw error;
    }
  }

  async function handleApprove(data: { orderID: string }): Promise<void> {
    try {
      // After the user approves, ask the backend to capture the payment.
      const response = await fetch("/api/paypal/capture-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: data.orderID }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        if (response.status === 401) {
          router.push("/login");
          toast.error(t("loginRequired"));
          throw new Error(result.error || "Unauthorized");
        }
        throw new Error(result.error || t("paymentFailed"));
      }

      // Pending state (eCheck clearing, risk review, ...) still lands on the
      // success page — it re-verifies the capture via order_id and renders
      // the processing copy; refreshing re-checks settlement.
      const pending = Boolean(result.data?.pending);
      if (pending) {
        toast.info(result.data.message || t("paymentPending"), {
          duration: 5000,
        });
      }

      const params = new URLSearchParams({
        provider: "paypal",
        order_id: result.data?.orderId ?? data.orderID,
      });
      if (pending) {
        params.set("pending", "true");
      }
      router.push(`/payment/success?${params.toString()}`);
    } catch (error) {
      console.error("[PayPal] Capture error:", error);
      const message =
        error instanceof Error ? error.message : t("paymentFailed");
      toast.error(message);
      throw error;
    }
  }

  function handleError(err: Record<string, unknown>): void {
    console.error("[PayPal] Button error:", err);
  }

  return (
    <PayPalScriptProvider options={options}>
      <PayPalButtons
        style={{ layout: "vertical", label: "pay" }}
        createOrder={handleCreateOrder}
        onApprove={handleApprove}
        onError={handleError}
      />
    </PayPalScriptProvider>
  );
}
