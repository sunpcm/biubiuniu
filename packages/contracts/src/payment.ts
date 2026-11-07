/**
 * Runtime list of every supported provider, in stable declaration order. Used
 * to build the PostgreSQL `payment_provider` enum and to iterate provider
 * switches without repeating the literal union.
 */
export const PAYMENT_PROVIDERS = [
  "stripe",
  "creem",
  "paypal",
] as const;

/**
 * Canonical payment provider identity.
 *
 * Derived from `PAYMENT_PROVIDERS` so the union and the runtime tuple can
 * never drift apart. The PostgreSQL `payment_provider` enum mirrors this exact
 * set of values.
 */
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];
