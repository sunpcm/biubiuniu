/**
 * [INPUT]: Depends on @/lib/db and the orders/user tables of schema, getStripe
 *          of @/lib/stripe, refundPayPalCapture of @/lib/paypal/client,
 *          refundCreemTransaction of @/lib/creem/client, isAdmin of
 *          @/lib/auth/server, the PaymentProvider type of @/config/pricing
 * [OUTPUT]: Exports getAdminOrders, refundOrder, AdminOrderItem
 * [POS]: The admin side of actions/orders — order list queries and refund
 *        dispatch across providers; a refund only calls the provider API, while
 *        local state and credit clawback are uniformly done by each provider's
 *        webhook (stripe: charge.refunded / paypal: PAYMENT.CAPTURE.REFUNDED /
 *        creem: refund.created; the Creem refund API supports only full refunds
 *        of a transaction, partial refunds must be issued from its dashboard)
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

'use server';

import { type PaymentProvider } from '@/config/pricing';
import { actionResponse, ActionResult } from '@/lib/action-response';
import { isAdmin } from '@/lib/auth/server';
import { db } from '@/lib/db';
import {
  orders,
  OrderStatus,
  OrderType,
  type OrderRow,
  user as userSchema,
} from '@/lib/db/schema';
import { refundCreemTransaction } from '@/lib/creem/client';
import { getLogger } from '@/lib/logger';
import { refundPayPalCapture } from '@/lib/paypal/client';
import { getStripe } from '@/lib/stripe';
import { and, count, desc, eq, ilike, or } from 'drizzle-orm';

const logger = getLogger('orders.admin')

export interface AdminOrderItem {
  id: string
  /** Payer; when the account is deleted the order row survives and the payer is nulled (financial records are de-identified) */
  userId: string | null
  userEmail: string | null
  userName: string | null
  planId: string
  orderType: OrderType
  status: OrderStatus
  creditsGranted: number
  amountTotal: number
  amountRefunded: number
  currency: string
  provider: PaymentProvider
  /** Charge/capture/payment-intent id — the handle refunds are issued against. */
  providerPaymentId: string | null
  createdAt: Date
}

/** Paginated, filterable order list for the admin dashboard. */
export async function getAdminOrders(params: {
  pageIndex: number
  pageSize: number
  /** Restrict to one user (user-detail page) */
  userId?: string
  status?: OrderStatus
  orderType?: OrderType
  provider?: PaymentProvider
  /** Matches user email or plan id (partial, case-insensitive) */
  search?: string
}): Promise<ActionResult<{ items: AdminOrderItem[]; total: number }>> {
  if (!(await isAdmin())) return actionResponse.forbidden()

  const { pageIndex, pageSize, userId, status, orderType, provider, search } =
    params
  const where = and(
    userId ? eq(orders.userId, userId) : undefined,
    status ? eq(orders.status, status) : undefined,
    orderType ? eq(orders.orderType, orderType) : undefined,
    provider ? eq(orders.provider, provider) : undefined,
    search
      ? or(
          ilike(userSchema.email, `%${search}%`),
          ilike(orders.planId, `%${search}%`)
        )
      : undefined
  )

  try {
    const base = db
      .select({
        id: orders.id,
        userId: orders.userId,
        userEmail: userSchema.email,
        userName: userSchema.name,
        planId: orders.planId,
        orderType: orders.orderType,
        status: orders.status,
        creditsGranted: orders.creditsGranted,
        amountTotal: orders.amountTotal,
        amountRefunded: orders.amountRefunded,
        currency: orders.currency,
        provider: orders.provider,
        providerPaymentId: orders.providerPaymentId,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .leftJoin(userSchema, eq(orders.userId, userSchema.id))
      .where(where)

    const [items, [{ total }]] = await Promise.all([
      base
        .orderBy(desc(orders.createdAt))
        .limit(pageSize)
        .offset(pageIndex * pageSize),
      db
        .select({ total: count() })
        .from(orders)
        .leftJoin(userSchema, eq(orders.userId, userSchema.id))
        .where(where),
    ])

    return actionResponse.success({ items, total })
  } catch (error) {
    logger.error({ err: error }, 'Failed to load admin orders.')
    return actionResponse.error('Failed to load orders.')
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  Refund dispatch — one provider, one branch, one webhook closes the loop
// ────────────────────────────────────────────────────────────────────────────

/** Integer cents → provider decimal string ("1050" → "10.50"). */
function centsToDecimalString(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * Issues the refund at the provider. Local state (order status, amountRefunded,
 * credit clawback) is NEVER touched here — each provider's refund webhook is
 * the single writer, so dashboard-initiated and provider-dashboard-initiated
 * refunds share one code path.
 */
async function issueProviderRefund(
  order: OrderRow,
  paymentId: string,
  amountCents: number | undefined
): Promise<ActionResult<{ refundId: string }>> {
  switch (order.provider) {
    case 'stripe': {
      // Refund against the payment intent; `charge.refunded` webhook follows.
      const refund = await getStripe().refunds.create({
        payment_intent: paymentId,
        amount: amountCents,
        reason: 'requested_by_customer',
      })
      return actionResponse.success({ refundId: refund.id })
    }
    case 'paypal': {
      // Refund against the capture; `PAYMENT.CAPTURE.REFUNDED` webhook follows.
      // Omitting the amount refunds the full remaining capture balance.
      const refund = await refundPayPalCapture(
        paymentId,
        amountCents !== undefined
          ? {
              value: centsToDecimalString(amountCents),
              currency_code: order.currency.toUpperCase(),
            }
          : undefined
      )
      return actionResponse.success({ refundId: refund.id })
    }
    case 'creem': {
      // Creem refunds the full remaining amount of a transaction — no amount
      // parameter exists; partial refunds stay a dashboard-only operation.
      // The `refund.created` webhook then syncs our local state.
      if (amountCents !== undefined) {
        return actionResponse.badRequest(
          'Creem only supports full refunds via API; issue partial refunds from the Creem dashboard.'
        )
      }
      const refund = await refundCreemTransaction(paymentId)
      return actionResponse.success({ refundId: `${paymentId}:${refund.status}` })
    }
  }
}

/**
 * Refund an order (fully, or partially via amountCents) through its payment
 * provider. The local order and the user's credits are updated by the
 * provider's refund webhook — one code path for dashboard-initiated and
 * provider-dashboard-initiated refunds alike.
 */
export async function refundOrder(params: {
  orderId: string
  /** Partial refund amount in cents; omit for a full refund of the remainder */
  amountCents?: number
}): Promise<ActionResult<{ refundId: string }>> {
  if (!(await isAdmin())) return actionResponse.forbidden()

  const { orderId, amountCents } = params

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)

  if (!order) return actionResponse.notFound('Order not found.')
  if (order.status === 'pending' || order.status === 'failed') {
    // An in-flight/failed audit-trail row has no settled money to refund — the provider would reject it anyway.
    return actionResponse.badRequest(
      'Order has no settled payment to refund (pending or failed).'
    )
  }
  if (!order.providerPaymentId) {
    return actionResponse.badRequest('Order has no provider payment to refund.')
  }

  const refundable = order.amountTotal - order.amountRefunded
  if (refundable <= 0) {
    return actionResponse.badRequest('Order is already fully refunded.')
  }
  if (amountCents !== undefined) {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return actionResponse.badRequest('Refund amount must be a positive integer of cents.')
    }
    if (amountCents > refundable) {
      return actionResponse.badRequest(
        `Refund amount exceeds the refundable remainder (${refundable}).`
      )
    }
  }

  try {
    return await issueProviderRefund(order, order.providerPaymentId, amountCents)
  } catch (error) {
    logger.error(
      {
        err: error,
        orderId: order.id,
        provider: order.provider,
        amountCents,
      },
      'Failed to issue provider refund.'
    )
    return actionResponse.error(
      `${order.provider} refund failed. Check the provider dashboard.`
    )
  }
}
