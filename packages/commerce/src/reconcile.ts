import type { CommerceRuntime } from "./context.js";
import { safeUnknownError } from "./privacy.js";
import type { SubscriptionRow } from "./store.js";
import type { PaymentProvider } from "./types.js";

const RENEWAL_GRACE_MS = 60 * 60 * 1000;
const PENDING_CAPTURE_GRACE_MS = 60 * 60 * 1000;

export type ReconcileOutcome = "ended" | "fulfilled" | "synced";

export async function reconcileOverdue(rt: CommerceRuntime, limit: number, reconcilers: Partial<Record<PaymentProvider, (row: SubscriptionRow) => Promise<ReconcileOutcome>>>): Promise<{ overdue: number; fulfilled: number; ended: number; failed: number }> {
  const providers = Object.keys(reconcilers) as PaymentProvider[];
  if (!providers.length) return { overdue: 0, fulfilled: 0, ended: 0, failed: 0 };
  const cutoff = new Date(rt.deps.clock.now().getTime() - RENEWAL_GRACE_MS);
  const overdue = await rt.withUnit(undefined, (unit) => unit.subscriptions.listOverdueRenewals(providers, cutoff, limit));
  let fulfilled = 0;
  let ended = 0;
  let failed = 0;
  for (const row of overdue) {
    const reconcile = reconcilers[row.provider];
    if (!reconcile) continue;
    try {
      const outcome = await reconcile(row);
      if (outcome === "fulfilled") fulfilled += 1;
      else if (outcome === "ended") ended += 1;
    } catch (error) {
      failed += 1;
      rt.log("error", { provider: row.provider, providerSubscriptionId: row.providerSubscriptionId, err: safeUnknownError(error) }, "Overdue renewal reconciliation failed");
      await rt.withUnit(undefined, (unit) => unit.subscriptions.touch(row.id, rt.deps.clock.now())).catch(() => undefined);
    }
  }
  return { overdue: overdue.length, fulfilled, ended, failed };
}

export async function listPendingPayPalPage(rt: CommerceRuntime, limit: number) {
  const cutoff = new Date(rt.deps.clock.now().getTime() - PENDING_CAPTURE_GRACE_MS);
  return rt.withUnit(undefined, (unit) => unit.orders.listPendingPayPal(cutoff, limit));
}
