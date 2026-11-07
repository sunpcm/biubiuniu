/**
 * [INPUT]: Depends on @/lib/stripe for getStripe, @/lib/db and schema for the user table
 * [OUTPUT]: Exports getOrCreateStripeCustomer
 * [POS]: Stripe customer mapping of lib/billing — the only reader/writer of
 *        user.stripeCustomerId; both checkout and portal obtain their Stripe
 *        customer through it
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { db } from '@/lib/db';
import { user as userSchema } from '@/lib/db/schema';
import { getStripe } from '@/lib/stripe';
import { eq } from 'drizzle-orm';

/**
 * Returns the user's Stripe customer id, creating the customer on first use.
 * The customer carries `metadata.userId` so webhooks can always resolve the
 * user even when session metadata is missing.
 */
export async function getOrCreateStripeCustomer(params: {
  userId: string
  email: string
  name?: string | null
}): Promise<string> {
  const { userId, email, name } = params
  const stripe = getStripe()

  const [row] = await db
    .select({ stripeCustomerId: userSchema.stripeCustomerId })
    .from(userSchema)
    .where(eq(userSchema.id, userId))
    .limit(1)

  // Self-heal: the stored id can go stale (test→live key switch, customer
  // deleted in the Stripe dashboard). Verify before trusting it.
  if (row?.stripeCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(row.stripeCustomerId)
      if (!existing.deleted) return row.stripeCustomerId
    } catch (error) {
      const missing =
        error instanceof Error && /No such customer/i.test(error.message)
      if (!missing) throw error
    }
  }

  const customer = await stripe.customers.create({
    email,
    name: name ?? undefined,
    metadata: { userId },
  })

  await db
    .update(userSchema)
    .set({ stripeCustomerId: customer.id })
    .where(eq(userSchema.id, userId))

  return customer.id
}
