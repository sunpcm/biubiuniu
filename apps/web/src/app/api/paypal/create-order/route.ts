/**
 * [INPUT]: Depends on @/lib/paypal/create-order for the testable production
 *          factory, plus the concrete auth, config, billing and PayPal wiring
 * [OUTPUT]: Exports POST (/api/paypal/create-order)
 * [POS]: Thin Next route adapter. All plan, workspace, price and privacy policy
 *        remains in lib/paypal/create-order so Next only sees its allowed POST
 *        export and this module does not expose test seams as route fields.
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { getPlanById, getPlanCopy } from "@/config/pricing";
import { isPurchaseEnabled } from "@/config/features";
import { getSession, getWorkspaceContext } from "@/lib/auth/server";
import { recordPayPalSourceBinding } from "@/lib/billing/paypal-source";
import { createPayPalOrder, isPayPalEnabled } from "@/lib/paypal";
import { createPayPalCreateOrderHandler } from "@/lib/paypal/create-order";

export const POST = createPayPalCreateOrderHandler({
  isPurchaseEnabled,
  getFreshSession: getSession,
  getWorkspace: getWorkspaceContext,
  getPlan: getPlanById,
  getPlanCopy,
  paypalEnabled: isPayPalEnabled,
  createOrder: createPayPalOrder,
  recordSourceBinding: recordPayPalSourceBinding,
});
