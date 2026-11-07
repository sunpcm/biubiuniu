export type PaymentProvider = "stripe" | "creem" | "paypal";

export type CanonicalSubscriptionStatus =
  | "active" | "trialing" | "past_due" | "unpaid"
  | "canceled" | "incomplete" | "expired" | "paused";

export const TERMINAL_SUBSCRIPTION_STATUSES: readonly CanonicalSubscriptionStatus[] = ["canceled", "expired"];
export const ENTITLED_SUBSCRIPTION_STATUSES: readonly CanonicalSubscriptionStatus[] = ["active", "trialing", "past_due", "unpaid"];
export const GRANTABLE_SUBSCRIPTION_STATUSES: readonly CanonicalSubscriptionStatus[] = ["active", "trialing"];
export const RECONCILABLE_SUBSCRIPTION_STATUSES: readonly CanonicalSubscriptionStatus[] = ["active", "trialing", "past_due"];

export type CreditTransactionType =
  | "purchase" | "subscription_grant" | "subscription_cycle_expire" | "usage"
  | "usage_refund" | "refund_revoke" | "subscription_end_revoke" | "admin_adjustment" | "signup_bonus";

export type OrderType = "one_time" | "subscription_initial" | "subscription_renewal" | "subscription_upgrade";
export type OrderStatus = "pending" | "completed" | "partially_refunded" | "refunded" | "failed";
export type PlanInterval = "month" | "year";

export interface BillingSubject {
  userId: string | null;
  organizationId: string | null;
}

export interface CreditSubject {
  userId: string | null;
  organizationId?: string | null;
}

export interface CreditBuckets {
  subscription: number;
  purchased: number;
}

export interface SubscriptionRef {
  provider: PaymentProvider;
  providerSubscriptionId: string;
}

export interface SubscriptionSyncInput {
  provider: PaymentProvider;
  providerSubscriptionId: string;
  subject: BillingSubject;
  planId: string;
  providerCustomerId?: string | null;
  providerPriceId?: string | null;
  status: CanonicalSubscriptionStatus;
  interval: PlanInterval;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: Date | null;
  endedAt?: Date | null;
  monthlyCredits: number;
  metadata?: Record<string, unknown> | null;
}

export interface OneTimePaymentInput {
  provider: PaymentProvider;
  providerOrderId: string;
  providerPaymentId?: string | null;
  subject: BillingSubject;
  planId: string;
  credits: number;
  amountTotal: number;
  amountSubtotal?: number | null;
  amountDiscount?: number;
  amountTax?: number;
  currency: string;
  metadata?: Record<string, unknown> | null;
}

export interface SubscriptionPaymentInput {
  subscription: SubscriptionSyncInput;
  orderType: "subscription_initial" | "subscription_renewal";
  providerOrderId: string;
  providerPaymentId?: string | null;
  amountTotal: number;
  amountSubtotal?: number | null;
  amountDiscount?: number;
  amountTax?: number;
  currency: string;
  periodStart?: Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface SubscriptionUpdatePaymentInput {
  subscription: SubscriptionSyncInput;
  providerOrderId: string;
  providerPaymentId?: string | null;
  amountTotal: number;
  amountSubtotal?: number | null;
  amountDiscount?: number;
  amountTax?: number;
  currency: string;
  metadata?: Record<string, unknown> | null;
}

export interface RefundInput {
  provider: PaymentProvider;
  providerOrderId?: string | null;
  providerPaymentId?: string | null;
  amountRefunded: number;
  cumulative?: boolean;
  refundId?: string | null;
}

export interface SubscriptionEndPatch {
  status?: CanonicalSubscriptionStatus;
  canceledAt?: Date | null;
  endedAt?: Date | null;
  cancelAtPeriodEnd?: boolean;
}

export interface ProviderPriceRef {
  test: string;
  live: string;
}

export interface CommercePlan {
  id: string;
  provider: PaymentProvider;
  kind: "credit_pack" | "subscription";
  interval?: PlanInterval;
  credits?: number;
  monthlyCredits?: number;
  stripePriceId?: ProviderPriceRef;
  creemProductId?: ProviderPriceRef;
  paypalPlanId?: ProviderPriceRef;
}

export interface CommerceCatalog {
  getPlanById(planId: string): CommercePlan | undefined;
  findPlanByProviderPriceId(provider: PaymentProvider, id: string): CommercePlan | undefined;
}

export interface FreshPrincipal {
  userId: string;
  banned: boolean;
  revoked: boolean;
}

export interface TrustedIdentity {
  getFreshPrincipal(): Promise<FreshPrincipal | null>;
  isLiveMember(userId: string, organizationId: string): Promise<boolean>;
}

export interface CommerceLogger {
  warn(data: object, message: string): void;
  error(data: object, message: string): void;
}

export interface CommerceClock {
  now(): Date;
}

export interface OrderCommittedNotice {
  orderType: OrderType;
  planId: string;
  creditsGranted: number;
  amountTotal: number;
  currency: string;
  userId: string;
}

export interface CommerceNotifier {
  onOrderCommitted?(notice: OrderCommittedNotice): void | Promise<void>;
  onDuplicateSubscription?(notice: Record<string, unknown>): void | Promise<void>;
  onCreditGrantFailed?(notice: { userId: string; orderId: string; planId: string; errorMessage: string; errorStack?: string }): void | Promise<void>;
  onInvoicePaymentFailed?(notice: Record<string, unknown>): void | Promise<void>;
  onFraudWarning?(notice: Record<string, unknown>): void | Promise<void>;
  onFraudRefund?(notice: Record<string, unknown>): void | Promise<void>;
  onPaymentDenied?(notice: Record<string, unknown>): void | Promise<void>;
  onDispute?(notice: Record<string, unknown>): void | Promise<void>;
}

