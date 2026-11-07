/**
 * [INPUT]: Depends on @/lib/db and the schema's orders table, @/lib/auth/server's
 *          getSession, @/config/pricing's getPlanName, next-intl/server's getLocale
 * [OUTPUT]: Exports getMyOrders, MyOrderItem (server action + type)
 * [POS]: The user side of actions/orders — the data source for the billing page's
 *        order history; planName is resolved from config/pricing by request locale,
 *        so the UI carries zero translation burden
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

'use server';

import { getPlanName, type PaymentProvider } from '@/config/pricing';
import { actionResponse, ActionResult } from '@/lib/action-response';
import { getSession } from '@/lib/auth/server';
import { db } from '@/lib/db';
import { orders, OrderStatus, OrderType } from '@/lib/db/schema';
import { getLogger } from '@/lib/logger';
import { count, desc, eq } from 'drizzle-orm';
import { getLocale } from 'next-intl/server';

const logger = getLogger('orders.user')

export interface MyOrderItem {
  id: string
  planId: string
  /** Localized plan display name resolved from config/pricing. */
  planName: string
  orderType: OrderType
  status: OrderStatus
  provider: PaymentProvider
  creditsGranted: number
  amountTotal: number
  amountRefunded: number
  currency: string
  createdAt: Date
}

/** Paginated purchase history for the signed-in user. */
export async function getMyOrders(params: {
  pageIndex: number
  pageSize: number
}): Promise<ActionResult<{ items: MyOrderItem[]; total: number }>> {
  const session = await getSession()
  const user = session?.user
  if (!user) return actionResponse.unauthorized()

  const { pageIndex, pageSize } = params
  const where = eq(orders.userId, user.id)

  try {
    const locale = await getLocale()
    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          id: orders.id,
          planId: orders.planId,
          orderType: orders.orderType,
          status: orders.status,
          provider: orders.provider,
          creditsGranted: orders.creditsGranted,
          amountTotal: orders.amountTotal,
          amountRefunded: orders.amountRefunded,
          currency: orders.currency,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .where(where)
        .orderBy(desc(orders.createdAt))
        .limit(pageSize)
        .offset(pageIndex * pageSize),
      db.select({ total: count() }).from(orders).where(where),
    ])

    const items = rows.map((row) => ({
      ...row,
      planName: getPlanName(row.planId, locale),
    }))

    return actionResponse.success({ items, total })
  } catch (error) {
    logger.error({ err: error, userId: user.id }, 'Failed to load user orders.')
    return actionResponse.error('Failed to load orders.')
  }
}
