import { commerceBillingReads } from "./billing-query.js";
import { buildSourceIdentityCatalog, getPlanCredits, isSubscriptionPlan, resolvePlanBySource } from "./catalog.js";
import { assertNewPurchaseOpen, attachPendingPayPalCapture, authorizeInteractiveCapture, boundPayPalCapture, decodePayPalCustomId, encodePayPalCustomId, recordPayPalSourceBinding, resolvePayPalSourceBinding } from "./capture.js";
import { createRuntime, type CommerceDeps } from "./context.js";
import { addCreditsIn, adjustIn, deductCreditsIn, grantPurchasedIn, grantUpgradeIn, refundSpentIn, resetSubscriptionIn, revokeIn, setCreditsIn, signupBonusIn, spendIn, clearSubscriptionIn } from "./credits.js";
export type { AdminCreditParams, CreditBucket } from "./credits.js";
import { addMonthsClamped, settleBatch, settleDripIn, settleDueApart, settleDueIn } from "./drip.js";
import { settleDuplicate } from "./duplicate.js";
import { DuplicateRefundFailedError, InsufficientCreditsError, PermanentFulfillmentError, RefundHistoryIncompleteError, publicBillingFailure } from "./errors.js";
import { applyRefundIn, endSubscriptionIn, fulfillOneTimeIn, fulfillSubscriptionIn, fulfillUpgradeIn, recordPendingIn, resolveSubject, resolveValidOrganizationId, resolveValidUserId, syncSubscriptionIn } from "./fulfillment.js";
import { assertCreditAmount, paypalAmountToMinor } from "./money.js";
import { notifyCreditGrantFailed, notifyInvoicePaymentFailed } from "./notify.js";
import { sanitizeLogData, sanitizeLogError, sanitizeLogText, safeUnknownError } from "./privacy.js";
import { listPendingPayPalPage, reconcileOverdue } from "./reconcile.js";
import { decideRefundAdvance } from "./refund.js";
import { assertBoundMetadata, resolveHistoricalOrderSource, resolveSubscriptionSource } from "./source.js";
import type { CommerceUnit } from "./store.js";
import { ENTITLED_SUBSCRIPTION_STATUSES, GRANTABLE_SUBSCRIPTION_STATUSES, TERMINAL_SUBSCRIPTION_STATUSES } from "./types.js";
import type { BillingSummary, UserCredits } from "./reads.js";
import { getOrganizationBillingSummary, getOrganizationCredits, getUserBillingSummary, getUserCredits, hasEntitledSubscription } from "./reads.js";

export function createCommerce(deps: CommerceDeps) {
  if (!deps.productId) throw new Error("Commerce instance requires productId");
  const catalog = {
    getPlanById: (id: string) => {
      const plan = deps.catalog.getPlanById(id);
      return plan ? structuredClone(plan) : undefined;
    },
    findPlanByProviderPriceId: (provider: Parameters<CommerceDeps["catalog"]["findPlanByProviderPriceId"]>[0], externalId: string) => {
      const plan = deps.catalog.findPlanByProviderPriceId(provider, externalId);
      return plan ? structuredClone(plan) : undefined;
    },
  };
  const rt = createRuntime({ ...deps, catalog }, catalog);
  const operations = (outer: CommerceUnit | undefined) => {
    const run = <T>(fn: (unit: CommerceUnit) => Promise<T>) => rt.withUnit(outer, fn);
    return {
      grantPurchasedCredits: (params: Parameters<typeof grantPurchasedIn>[2]) => run((unit) => grantPurchasedIn(rt, unit, params)),
      resetSubscriptionCredits: (params: Parameters<typeof resetSubscriptionIn>[2]) => run((unit) => resetSubscriptionIn(rt, unit, params)),
      grantSubscriptionUpgradeCredits: (params: Parameters<typeof grantUpgradeIn>[2]) => run((unit) => grantUpgradeIn(rt, unit, params)),
      spendCredits: async (params: Parameters<typeof spendIn>[2]) => {
        if (outer) {
          return run(async (unit) => {
            await settleDueIn(rt, unit, params);
            return spendIn(rt, unit, params);
          });
        }
        await settleDueApart(rt, params);
        return run((unit) => spendIn(rt, unit, params));
      },
      refundSpentCredits: (params: Parameters<typeof refundSpentIn>[2]) => run((unit) => refundSpentIn(rt, unit, params)),
      revokeCreditsForRefund: (params: Parameters<typeof revokeIn>[2]) => run((unit) => revokeIn(rt, unit, params)),
      clearSubscriptionCredits: (params: Parameters<typeof clearSubscriptionIn>[2]) => run((unit) => clearSubscriptionIn(rt, unit, params)),
      grantSignupBonusCredits: (params: Parameters<typeof signupBonusIn>[2]) => run((unit) => signupBonusIn(rt, unit, params)),
      adjustCredits: (params: Parameters<typeof adjustIn>[2]) => run((unit) => adjustIn(rt, unit, params)),
      addCredits: (params: Parameters<typeof addCreditsIn>[2]) => run((unit) => addCreditsIn(rt, unit, params)),
      setCredits: (params: Parameters<typeof setCreditsIn>[2]) => run((unit) => setCreditsIn(rt, unit, params)),
      deductCredits: (params: Parameters<typeof deductCreditsIn>[2]) => run((unit) => deductCreditsIn(rt, unit, params)),
      settleDripForSubscription: (subscriptionId: string) => run((unit) => settleDripIn(rt, unit, subscriptionId)),
      settleDueDripGrants: (subject: Parameters<typeof settleDueIn>[2]) => (
        outer ? run((unit) => settleDueIn(rt, unit, subject)) : settleDueApart(rt, subject)
      ),
      fulfillOneTimePurchase: (input: Parameters<typeof fulfillOneTimeIn>[2]) => run((unit) => fulfillOneTimeIn(rt, unit, input)),
      recordPendingOneTimePurchase: (input: Parameters<typeof recordPendingIn>[2]) => run((unit) => recordPendingIn(rt, unit, input)),
      syncSubscription: (input: Parameters<typeof syncSubscriptionIn>[2]) => run((unit) => syncSubscriptionIn(rt, unit, input)),
      fulfillSubscriptionPayment: (input: Parameters<typeof fulfillSubscriptionIn>[2]) => run((unit) => fulfillSubscriptionIn(rt, unit, input)),
      fulfillSubscriptionUpgrade: (input: Parameters<typeof fulfillUpgradeIn>[2]) => run((unit) => fulfillUpgradeIn(rt, unit, input)),
      handleSubscriptionEnded: (provider: Parameters<typeof endSubscriptionIn>[2], providerSubscriptionId: string, patch?: Parameters<typeof endSubscriptionIn>[4]) => run((unit) => endSubscriptionIn(rt, unit, provider, providerSubscriptionId, patch)),
      applyRefund: (input: Parameters<typeof applyRefundIn>[2]) => run((unit) => applyRefundIn(rt, unit, input)),
    };
  };
  const api = {
    productId: deps.productId,
    addMonthsClamped,
    ENTITLED_SUBSCRIPTION_STATUSES,
    GRANTABLE_SUBSCRIPTION_STATUSES,
    TERMINAL_SUBSCRIPTION_STATUSES,
    InsufficientCreditsError,
    PermanentFulfillmentError,
    RefundHistoryIncompleteError,
    DuplicateRefundFailedError,
    assertCreditAmount,
    paypalAmountToMinor,
    buildSourceIdentityCatalog,
    resolvePlanBySource,
    isSubscriptionPlan,
    getPlanCredits,
    sanitizeLogText,
    sanitizeLogData,
    sanitizeLogError,
    safeUnknownError,
    publicBillingFailure,
    decideRefundAdvance,
    assertNewPurchaseOpen: () => assertNewPurchaseOpen(rt),
    authorizeInteractiveCapture: (input: { organizationId?: string | null }) => authorizeInteractiveCapture(rt, input),
    resolveValidUserId: (candidate: string | null | undefined) => resolveValidUserId(rt, candidate),
    resolveValidOrganizationId: (candidate: string | null | undefined) => resolveValidOrganizationId(rt, candidate),
    resolveSubject: (params: { userId?: string | null; organizationId?: string | null }) => resolveSubject(rt, params),
    assertBoundMetadata,
    resolveSubscriptionSource: (params: Parameters<typeof resolveSubscriptionSource>[1]) => resolveSubscriptionSource(rt, params),
    resolveHistoricalOrderSource: (params: Parameters<typeof resolveHistoricalOrderSource>[1]) => resolveHistoricalOrderSource(rt, params),
    ...operations(undefined),
    settleDueDripGrantsBatch: (limit: number) => settleBatch(rt, limit),
    getUserCredits: (userId: string) => getUserCredits(rt, userId),
    getOrganizationCredits: (organizationId: string) => getOrganizationCredits(rt, organizationId),
    hasEntitledSubscription: (userId: string) => hasEntitledSubscription(rt, userId),
    getUserBillingSummary: (userId: string) => getUserBillingSummary(rt, userId),
    getOrganizationBillingSummary: (organizationId: string) => getOrganizationBillingSummary(rt, organizationId),
    settleDuplicateSubscription: (params: Parameters<typeof settleDuplicate>[1]) => settleDuplicate(rt, params),
    reconcileOverdueRenewals: (limit: number, reconcilers: Parameters<typeof reconcileOverdue>[2]) => reconcileOverdue(rt, limit, reconcilers),
    listPendingPayPalCaptures: (limit: number) => listPendingPayPalPage(rt, limit),
    notifyCreditGrantFailed: (params: Parameters<typeof notifyCreditGrantFailed>[1]) => notifyCreditGrantFailed(rt, params),
    notifyInvoicePaymentFailed: (params: Parameters<typeof notifyInvoicePaymentFailed>[1]) => notifyInvoicePaymentFailed(rt, params),
    recordPayPalSourceBinding: (binding: Parameters<typeof recordPayPalSourceBinding>[1]) => recordPayPalSourceBinding(rt, binding),
    resolvePayPalSourceBinding: (orderId?: string | null, captureId?: string | null) => resolvePayPalSourceBinding(rt, orderId, captureId),
    attachPendingPayPalCapture: (rowId: string, captureId: string, metadata: Record<string, unknown>) => attachPendingPayPalCapture(rt, rowId, captureId, metadata),
    boundPayPalCapture: (params: Parameters<typeof boundPayPalCapture>[1]) => boundPayPalCapture(rt, params),
    encodePayPalCustomId,
    decodePayPalCustomId,
    commerceBillingReads,
    /**
     * Bind later ledger calls to a unit this instance's store currently has open.
     * `spendCredits` settles due drips and spends on that same unit. Post-commit
     * work stays queued until the outer owner commits and calls `flushOuter`.
     * Do not call the unbound methods from inside that transaction: the store
     * refuses to open a second one.
     */
    join(unit: CommerceUnit) {
      return operations(unit);
    },
    runtime: rt,
  };
  return api;
}

export type Commerce = ReturnType<typeof createCommerce>;
export type CommerceBound = ReturnType<Commerce["join"]>;
export type { UserCredits, BillingSummary };
export { buildSourceIdentityCatalog, resolvePlanBySource, isSubscriptionPlan, getPlanCredits, addMonthsClamped };
export { InsufficientCreditsError, PermanentFulfillmentError, RefundHistoryIncompleteError, DuplicateRefundFailedError, publicBillingFailure };
export { ENTITLED_SUBSCRIPTION_STATUSES, TERMINAL_SUBSCRIPTION_STATUSES, GRANTABLE_SUBSCRIPTION_STATUSES };
export type { CommerceDeps } from "./context.js";
export type * from "./types.js";
export { commerceBillingReads };
export type { CommerceBillingQuery } from "./billing-query.js";
export type { CommerceStore, CommerceUnit, OrderDraft, OrderRow, SubscriptionDraft, SubscriptionRow } from "./store.js";
