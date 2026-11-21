/**
 * [INPUT]: Depends on @/lib/credits' spendCredits/refundSpentCredits/
 *          InsufficientCreditsError, @/lib/auth/server's getSession,
 *          @/lib/action-response
 * [OUTPUT]: exports simulateFailedTask, FailedTaskSimulation
 * [POS]: The dev-only server action of credit-usage-example — demonstrates the
 *        full server-side loop "deduct → task fails → refund to the original
 *        buckets → replay to prove idempotency"; refuses to run in production.
 *        It deliberately accepts no client-supplied txId: the refund only ever
 *        touches the spend this very flow produced, and refundSpentCredits is
 *        never exposed to the client
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

'use server';

import { actionResponse, ActionResult } from '@/lib/action-response';
import { getSession } from '@/lib/auth/server';
import {
  InsufficientCreditsError,
  refundSpentCredits,
  spendCredits,
} from '@/lib/credits';

export interface FailedTaskSimulation {
  /** Ledger row id of the usage that got refunded. */
  txId: string
  spentFromSubscription: number
  spentFromPurchased: number
  balanceAfterSpend: { subscription: number; purchased: number }
  balanceAfterRefund: { subscription: number; purchased: number }
  /** Second refund of the same txId must change nothing. */
  replayWasNoop: boolean
}

/**
 * Dev-only demo of the deduct-then-refund pattern for expensive AI tasks:
 * spend credits, pretend the task failed, refund to the original buckets,
 * then replay the refund to prove idempotency. The whole cycle runs server
 * side — the client never sees a refund capability, only the story.
 */
export async function simulateFailedTask(params: {
  amount: number
}): Promise<ActionResult<FailedTaskSimulation>> {
  if (process.env.NODE_ENV === 'production') {
    return actionResponse.forbidden('Only available in development.')
  }

  const session = await getSession()
  const user = session?.user
  if (!user) return actionResponse.unauthorized()

  const { amount } = params
  if (!Number.isInteger(amount) || amount <= 0 || amount > 1000) {
    return actionResponse.badRequest('Amount must be an integer in 1..1000.')
  }

  try {
    // 1. Deduct up front, exactly like a real generation endpoint would.
    const spend = await spendCredits({
      userId: user.id,
      amount,
      note: 'Simulated task (example page, will fail)',
    })

    // 2. ...the expensive task would run here. Pretend it threw.

    // 3. Refund the failed task to the buckets the credits came from.
    const balanceAfterRefund = await refundSpentCredits({
      userId: user.id,
      spendTxId: spend.txId,
      note: 'Simulated task failed — automatic refund (example page)',
    })

    // 4. Replay the refund (a retried webhook would do this) — no-op.
    const replayed = await refundSpentCredits({
      userId: user.id,
      spendTxId: spend.txId,
      note: 'Replayed refund (must be a no-op)',
    })

    return actionResponse.success({
      txId: spend.txId,
      spentFromSubscription: spend.spentFromSubscription,
      spentFromPurchased: spend.spentFromPurchased,
      balanceAfterSpend: spend.buckets,
      balanceAfterRefund,
      replayWasNoop:
        replayed.subscription === balanceAfterRefund.subscription &&
        replayed.purchased === balanceAfterRefund.purchased,
    })
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return actionResponse.badRequest(
        'Insufficient credits.',
        'INSUFFICIENT_CREDITS'
      )
    }
    console.error('simulateFailedTask failed:', error)
    return actionResponse.error('Simulation failed.')
  }
}
