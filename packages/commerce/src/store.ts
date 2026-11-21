import type {
  BillingSubject, CanonicalSubscriptionStatus, CreditBuckets, CreditSubject, CreditTransactionType,
  OrderStatus, OrderType, PaymentProvider, PlanInterval, SubscriptionRef,
} from "./types.js";

export interface LedgerAppend {
  userId: string | null;
  organizationId: string | null;
  type: CreditTransactionType;
  amount: number;
  subscriptionDelta: number;
  purchasedDelta: number;
  subscriptionCreditsAfter: number;
  purchasedCreditsAfter: number;
  note?: string | null;
  orderId?: string | null;
  refundedTransactionId?: string | null;
  createdAt: Date;
}

export interface UsageRow {
  userId: string | null;
  organizationId: string | null;
  subscriptionDelta: number;
  purchasedDelta: number;
}

export interface OrderDraft {
  userId: string | null;
  organizationId: string | null;
  planId: string;
  orderType: OrderType;
  status: OrderStatus;
  creditsGranted: number;
  amountTotal: number;
  amountSubtotal: number | null;
  amountDiscount: number;
  amountTax: number;
  currency: string;
  provider: PaymentProvider;
  providerOrderId: string;
  providerPaymentId: string | null;
  providerSubscriptionId?: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderRow extends OrderDraft {
  id: string;
  amountRefunded: number;
  refundedAt: Date | null;
}

export interface SubscriptionDraft {
  userId: string | null;
  organizationId: string | null;
  planId: string;
  provider: PaymentProvider;
  providerSubscriptionId: string;
  providerCustomerId: string | null;
  providerPriceId: string | null;
  status: CanonicalSubscriptionStatus;
  interval: PlanInterval;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  endedAt: Date | null;
  monthlyCredits: number;
  metadata?: Record<string, unknown> | null;
  updatedAt: Date;
}

export interface SubscriptionRow extends SubscriptionDraft {
  id: string;
  remainingGrants: number;
  nextGrantAt: Date | null;
  createdAt: Date;
}

export interface CommerceUnit {
  balances: {
    lock(subject: CreditSubject): Promise<CreditBuckets>;
    write(subject: CreditSubject, next: CreditBuckets, at: Date): Promise<void>;
    read(subject: CreditSubject): Promise<CreditBuckets>;
  };
  ledger: {
    append(entry: LedgerAppend): Promise<{ id: string }>;
    findUsage(id: string): Promise<UsageRow | null>;
    findRefundOf(spendTxId: string): Promise<{ id: string } | null>;
    hasSignupBonus(userId: string): Promise<boolean>;
    sumSubscriptionGrantsSince(subject: CreditSubject, since: Date): Promise<number>;
  };
  orders: {
    insertIfAbsent(draft: OrderDraft): Promise<{ id: string } | null>;
    lockById(id: string): Promise<OrderRow | null>;
    findByProviderOrder(provider: PaymentProvider, providerOrderId: string): Promise<OrderRow | null>;
    lockByProviderOrder(provider: PaymentProvider, providerOrderId: string): Promise<OrderRow | null>;
    findFirstByProviderPayment(provider: PaymentProvider, providerPaymentId: string): Promise<OrderRow | null>;
    update(id: string, patch: Partial<OrderRow> & { updatedAt: Date }): Promise<void>;
    listBySubscription(provider: PaymentProvider, providerSubscriptionId: string): Promise<OrderRow[]>;
    listPayPalBindings(orderId?: string | null, captureId?: string | null): Promise<OrderRow[]>;
    listPendingPayPal(cutoff: Date, limit: number): Promise<OrderRow[]>;
    touch(id: string, at: Date): Promise<void>;
    markPendingFailed(provider: PaymentProvider, captureId: string, at: Date): Promise<void>;
  };
  subscriptions: {
    upsert(row: SubscriptionDraft, preserveTerminal: boolean): Promise<void>;
    findByKey(provider: PaymentProvider, providerSubscriptionId: string): Promise<SubscriptionRow | null>;
    lockByKey(provider: PaymentProvider, providerSubscriptionId: string): Promise<SubscriptionRow | null>;
    findByLocalId(id: string): Promise<SubscriptionRow | null>;
    lockByLocalId(id: string): Promise<SubscriptionRow | null>;
    update(provider: PaymentProvider, providerSubscriptionId: string, patch: Partial<SubscriptionRow> & { updatedAt: Date }): Promise<void>;
    advisoryLockSubject(key: string): Promise<void>;
    listBySubject(subject: BillingSubject): Promise<SubscriptionRow[]>;
    listDueDrips(now: Date, subject?: CreditSubject, limit?: number): Promise<Array<{ id: string }>>;
    listOverdueRenewals(providers: PaymentProvider[], cutoff: Date, limit: number): Promise<SubscriptionRow[]>;
    touch(id: string, at: Date): Promise<void>;
    hasEntitledForUser(userId: string, entitled: readonly string[]): Promise<boolean>;
    findLatestEntitled(subject: BillingSubject, entitled: readonly string[]): Promise<SubscriptionRow | null>;
    hasOtherLive(subject: BillingSubject, exceptId: string, entitled: readonly string[]): Promise<boolean>;
    countOtherSubscriptionOrders(provider: PaymentProvider, providerSubscriptionId: string, exceptProviderOrderId: string): Promise<number>;
  };
  /**
   * Reads Auth compensation can run on this same unit. Seat totals stay in the
   * caller's catalog. These methods must not open another connection.
   */
  billing: {
    /** Purchaser deletion gate. Membership in someone else's live plan does not count. */
    userHasLiveSubscription(userId: string, entitled: readonly string[]): Promise<boolean>;
    /** Newest entitled organization subscription. Null means no live team plan. */
    findLiveOrganizationPlan(
      organizationId: string,
      entitled: readonly string[],
    ): Promise<{ planId: string; status: CanonicalSubscriptionStatus } | null>;
    /**
     * Organization deletion gate: any subscription row or any credit ledger row.
     * A pending order with neither does not count, matching the current rule.
     */
    organizationHasBillingHistory(organizationId: string): Promise<boolean>;
  };
  identity: {
    findLivingUserId(id: string): Promise<string | null>;
    findLivingOrganizationId(id: string): Promise<string | null>;
    isLiveMember(userId: string, organizationId: string): Promise<boolean>;
    findUserIdByProviderCustomer(provider: PaymentProvider, customerId: string): Promise<string | null>;
    readProviderCustomer(userId: string, provider: PaymentProvider): Promise<string | null>;
    writeProviderCustomerIfAbsent(userId: string, provider: PaymentProvider, customerId: string, at: Date): Promise<"written" | "same" | "conflict" | "missing">;
    findUserEmail(userId: string): Promise<string | null>;
  };
}

export interface CommerceStore {
  /**
   * Open a transaction, or continue `outer` when it is the unit this store
   * currently has open. Continuing `outer` must not open another connection
   * or queue behind that transaction. A closed or foreign unit is rejected.
   * Calling this without `outer` while a transaction is already open is
   * refused; the caller uses `commerce.join(unit)` instead.
   */
  transaction<T>(run: (unit: CommerceUnit) => Promise<T>, outer?: CommerceUnit): Promise<T>;
}

export type { SubscriptionRef };
