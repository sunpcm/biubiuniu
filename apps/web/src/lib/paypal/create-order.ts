/**
 * [INPUT]: Depends on @/config/pricing and @/config/features policy surfaces,
 *          @/lib/auth/server guard function types, PayPal order creation and
 *          source-binding implementations, @/lib/api-response, and the shared
 *          privacy-aware logger
 * [OUTPUT]: Exports PayPalCreateOrderDeps and createPayPalCreateOrderHandler
 * [POS]: Testable core of the PayPal one-time-order route. It preserves the
 *        existing purchase, session, plan, workspace and pricing checks while
 *        keeping Next's route module limited to allowed exports and concrete
 *        dependency assembly.
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { isPurchaseEnabled } from "@/config/features";
import { getPlanById, getPlanCopy } from "@/config/pricing";
import { apiResponse } from "@/lib/api-response";
import type { getSession, getWorkspaceContext } from "@/lib/auth/server";
import { recordPayPalSourceBinding } from "@/lib/billing/paypal-source";
import { getLogger, type AppLogger } from "@/lib/logger";
import { createPayPalOrder } from "@/lib/paypal";

export interface PayPalCreateOrderDeps {
  isPurchaseEnabled: typeof isPurchaseEnabled;
  getFreshSession: typeof getSession;
  getWorkspace: typeof getWorkspaceContext;
  getPlan: typeof getPlanById;
  getPlanCopy: typeof getPlanCopy;
  paypalEnabled: boolean;
  createOrder: typeof createPayPalOrder;
  recordSourceBinding: typeof recordPayPalSourceBinding;
  logger?: AppLogger;
}

export function createPayPalCreateOrderHandler(deps: PayPalCreateOrderDeps) {
  const logger = deps.logger ?? getLogger("billing.paypal.create-order");

  return async function POST(req: Request) {
    if (!deps.isPurchaseEnabled()) {
      return apiResponse.error("Checkout is not available yet.", 503);
    }

    const session = await deps.getFreshSession();
    const user = session?.user;
    if (!user) {
      return apiResponse.unauthorized();
    }

    if (!deps.paypalEnabled) {
      return apiResponse.serverError("PayPal is not configured.");
    }

    let planId: string | undefined;
    try {
      ({ planId } = await req.json());
    } catch {
      return apiResponse.badRequest("Invalid request body.");
    }
    if (!planId) {
      return apiResponse.badRequest("Missing planId.");
    }

    // config/pricing.ts is the pricing source of truth — no plans in the database,
    // and amounts are never trusted from the client.
    const plan = deps.getPlan(planId);
    if (!plan || plan.active === false) {
      return apiResponse.notFound(`Unknown plan: ${planId}`);
    }
    if (plan.provider !== "paypal") {
      return apiResponse.badRequest(
        `Plan ${planId} is not a PayPal plan (provider: ${plan.provider}).`,
      );
    }
    if (plan.kind !== "credit_pack") {
      return apiResponse.badRequest(
        "PayPal subscriptions are purchased through checkout, not the PayPal button flow.",
      );
    }

    // Credit packs are personal assets (custom_id carries no organizationId), so
    // buying one inside a team workspace would mean "paid, yet the current
    // workspace balance never moves" — the same iron rule as
    // createCheckoutSession's TEAM_WORKSPACE_CREDIT_PACK guard. 409 is this
    // route's only conflict semantic; PayPalCheckoutButton uses it to prompt
    // switching back to the personal workspace.
    const workspace = await deps.getWorkspace();
    if (workspace?.organizationId) {
      return apiResponse.conflict(
        "Credit packs are personal purchases. Switch to your personal workspace to buy one.",
      );
    }

    try {
      // plan.price is in major currency units (9.9 = $9.90); PayPal wants a decimal string.
      const paypalOrder = await deps.createOrder({
        amount: plan.price.toFixed(2),
        currency: plan.currency,
        description: deps.getPlanCopy(plan, "en").name,
        customIdData: {
          userId: user.id,
          planId: plan.id,
        },
      });

      // Persistent source binding: remember the verified external order
      // reference + subject + plan so capture/webhook can cross-check custom_id
      // instead of trusting the custom_id string alone.
      await deps.recordSourceBinding({
        orderId: paypalOrder.id,
        userId: user.id,
        organizationId: null,
        planId: plan.id,
        amountTotal: Math.round(plan.price * 100),
        currency: plan.currency,
      });

      return apiResponse.success({ orderId: paypalOrder.id });
    } catch (error) {
      logger.error(
        { planId: plan.id, userId: user.id, err: error },
        "PayPal order creation failed",
      );
      return apiResponse.serverError("Failed to create PayPal order.");
    }
  };
}
