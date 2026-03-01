/**
 * Shared types for payment verification
 */

import { PaymentProvider } from "@niu/db/schema";

export type Provider = PaymentProvider;

export type SubscriptionData = {
  id: string;
  planId: string | null;
  status: string;
  metadata: unknown;
};

export type OrderData = {
  id: string;
  metadata: unknown;
  status: string;
};
