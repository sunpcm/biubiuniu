/**
 * Credit ledger wrapper.
 *
 * The public production function names stay here and use the lazy app
 * singleton. createCreditLedger() closes over one explicit app commerce
 * instance for tests and route factories. Writes open a transaction on that
 * instance's store.
 * Callers that need several writes to commit together use
 * `runCommerceTransaction`; this module does not accept an outside handle.
 */

import type { CommerceBound } from "@sunpcm/niu-commerce";
import { InsufficientCreditsError } from "@sunpcm/niu-commerce";
import { coordinatePgCommerce } from "@sunpcm/niu-persistence-pg/commerce";
import { getAppCommerce, type AppCommerce } from "@/composition/commerce";

export { InsufficientCreditsError };

export interface CreditBuckets {
  subscription: number;
  purchased: number;
}

export interface SpendResult {
  buckets: CreditBuckets;
  txId: string;
  spentFromSubscription: number;
  spentFromPurchased: number;
}

export function createCreditLedger(app: AppCommerce) {
  const commerce = app.commerce;
  const currentCommerce = () => commerce;
  return {
    runCommerceTransaction<T>(work: (bound: CommerceBound) => Promise<T>): Promise<T> {
      return coordinatePgCommerce(app.store, commerce, ({ unit }) => work(commerce.join(unit)));
    },
    grantPurchasedCredits(params: Parameters<AppCommerce["commerce"]["grantPurchasedCredits"]>[0]) {
      return currentCommerce().grantPurchasedCredits(params);
    },
    resetSubscriptionCredits(
      params: Parameters<AppCommerce["commerce"]["resetSubscriptionCredits"]>[0],
    ) {
      return currentCommerce().resetSubscriptionCredits(params);
    },
    grantSubscriptionUpgradeCredits(
      params: Parameters<AppCommerce["commerce"]["grantSubscriptionUpgradeCredits"]>[0],
    ) {
      return currentCommerce().grantSubscriptionUpgradeCredits(params);
    },
    sumSubscriptionGrantsSince(
      subject: { userId: string | null; organizationId?: string | null },
      since: Date,
    ) {
      return commerce.runtime.withUnit(undefined, (opened) =>
        opened.ledger.sumSubscriptionGrantsSince(subject, since),
      );
    },
    spendCredits(params: Parameters<AppCommerce["commerce"]["spendCredits"]>[0]) {
      return currentCommerce().spendCredits(params);
    },
    refundSpentCredits(params: Parameters<AppCommerce["commerce"]["refundSpentCredits"]>[0]) {
      return currentCommerce().refundSpentCredits(params);
    },
    revokeCreditsForRefund(
      params: Parameters<AppCommerce["commerce"]["revokeCreditsForRefund"]>[0],
    ) {
      return currentCommerce().revokeCreditsForRefund(params);
    },
    clearSubscriptionCredits(
      params: Parameters<AppCommerce["commerce"]["clearSubscriptionCredits"]>[0],
    ) {
      return currentCommerce().clearSubscriptionCredits(params);
    },
    grantSignupBonusCredits(
      params: Parameters<AppCommerce["commerce"]["grantSignupBonusCredits"]>[0],
    ) {
      return currentCommerce().grantSignupBonusCredits(params);
    },
    adjustCredits(params: Parameters<AppCommerce["commerce"]["adjustCredits"]>[0]) {
      return currentCommerce().adjustCredits(params);
    },
    addCredits(params: Parameters<AppCommerce["commerce"]["addCredits"]>[0]) {
      return currentCommerce().addCredits(params);
    },
    setCredits(params: Parameters<AppCommerce["commerce"]["setCredits"]>[0]) {
      return currentCommerce().setCredits(params);
    },
    deductCredits(params: Parameters<AppCommerce["commerce"]["deductCredits"]>[0]) {
      return currentCommerce().deductCredits(params);
    },
  };
}

export type CreditLedger = ReturnType<typeof createCreditLedger>;

async function defaultLedger(): Promise<CreditLedger> {
  return createCreditLedger(await getAppCommerce());
}

export function runCommerceTransaction<T>(
  work: (commerce: CommerceBound) => Promise<T>,
): Promise<T> {
  return defaultLedger().then((ledger) => ledger.runCommerceTransaction(work));
}

export function grantPurchasedCredits(
  params: Parameters<AppCommerce["commerce"]["grantPurchasedCredits"]>[0],
) {
  return defaultLedger().then((ledger) => ledger.grantPurchasedCredits(params));
}

export function resetSubscriptionCredits(
  params: Parameters<AppCommerce["commerce"]["resetSubscriptionCredits"]>[0],
) {
  return defaultLedger().then((ledger) => ledger.resetSubscriptionCredits(params));
}

export function grantSubscriptionUpgradeCredits(
  params: Parameters<AppCommerce["commerce"]["grantSubscriptionUpgradeCredits"]>[0],
) {
  return defaultLedger().then((ledger) => ledger.grantSubscriptionUpgradeCredits(params));
}

export function sumSubscriptionGrantsSince(
  subject: { userId: string | null; organizationId?: string | null },
  since: Date,
) {
  return defaultLedger().then((ledger) => ledger.sumSubscriptionGrantsSince(subject, since));
}

export function spendCredits(params: Parameters<AppCommerce["commerce"]["spendCredits"]>[0]) {
  return defaultLedger().then((ledger) => ledger.spendCredits(params));
}

export function refundSpentCredits(
  params: Parameters<AppCommerce["commerce"]["refundSpentCredits"]>[0],
) {
  return defaultLedger().then((ledger) => ledger.refundSpentCredits(params));
}

export function revokeCreditsForRefund(
  params: Parameters<AppCommerce["commerce"]["revokeCreditsForRefund"]>[0],
) {
  return defaultLedger().then((ledger) => ledger.revokeCreditsForRefund(params));
}

export function clearSubscriptionCredits(
  params: Parameters<AppCommerce["commerce"]["clearSubscriptionCredits"]>[0],
) {
  return defaultLedger().then((ledger) => ledger.clearSubscriptionCredits(params));
}

export function grantSignupBonusCredits(
  params: Parameters<AppCommerce["commerce"]["grantSignupBonusCredits"]>[0],
) {
  return defaultLedger().then((ledger) => ledger.grantSignupBonusCredits(params));
}

export function adjustCredits(params: Parameters<AppCommerce["commerce"]["adjustCredits"]>[0]) {
  return defaultLedger().then((ledger) => ledger.adjustCredits(params));
}

export function addCredits(params: Parameters<AppCommerce["commerce"]["addCredits"]>[0]) {
  return defaultLedger().then((ledger) => ledger.addCredits(params));
}

export function setCredits(params: Parameters<AppCommerce["commerce"]["setCredits"]>[0]) {
  return defaultLedger().then((ledger) => ledger.setCredits(params));
}

export function deductCredits(params: Parameters<AppCommerce["commerce"]["deductCredits"]>[0]) {
  return defaultLedger().then((ledger) => ledger.deductCredits(params));
}
