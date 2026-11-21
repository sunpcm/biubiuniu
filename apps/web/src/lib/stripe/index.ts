/**
 * [INPUT]: Depends on the stripe SDK and config/pricing's PricingPlan type
 * [OUTPUT]: Exports stripe (singleton | null), isStripeEnabled, stripeMode,
 *           getStripe, getStripePriceId
 * [POS]: Sole member of lib/stripe — the Stripe client and the test/live mode
 *        decision; all payment code reaches Stripe through here
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import type { PricingPlan } from '@/config/pricing';
import Stripe from 'stripe';

const secretKey = process.env.STRIPE_SECRET_KEY;

export const isStripeEnabled = Boolean(
  secretKey && process.env.STRIPE_WEBHOOK_SECRET
);

/**
 * test/live is derived from the secret key prefix, never configured
 * separately — two env vars can then never contradict each other.
 */
export const stripeMode: 'test' | 'live' = secretKey?.startsWith('sk_live')
  ? 'live'
  : 'test';

export const stripe: Stripe | null = secretKey
  ? new Stripe(secretKey, { typescript: true })
  : null;

if (!isStripeEnabled) {
  console.warn(
    'Warning: STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET is not set — Stripe payments are disabled'
  );
}

/** Throwing accessor for payment code paths — never continue when Stripe is unconfigured. */
export function getStripe(): Stripe {
  if (!stripe) {
    throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)');
  }
  return stripe;
}

/** Resolves a plan's Stripe Price id for the current key mode; calling it for a
 *  non-Stripe plan is a programming error. */
export function getStripePriceId(plan: PricingPlan): string {
  const ref = plan.stripePriceId;
  if (!ref) {
    throw new Error(
      `Plan ${plan.id} has no stripePriceId — its provider is ${plan.provider}`
    );
  }
  return ref[stripeMode];
}
