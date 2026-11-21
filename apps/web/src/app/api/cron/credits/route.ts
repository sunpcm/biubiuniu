/**
 * [INPUT]: Depends on @/lib/credits' settleDueDripGrantsBatch,
 *          @/lib/billing/reconcile's reconcileOverdueRenewals/
 *          reconcilePendingPayPalCaptures, and the CRON_SECRET env var
 * [OUTPUT]: Exports GET (health) + POST (trigger) — the /api/cron/credits scheduled refresh entry
 * [POS]: The credits scheduler of app/api/cron: triggered every minute by an external scheduler,
 *        it batch-settles due annual monthly drips, reconciles overdue unrenewed subscriptions
 *        (stripe only for now) and reconciles PayPal in-flight pending captures; all judged in UTC
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 *
 * ============================================================================
 * Scheduling examples (pick either):
 *
 *   - Coolify Scheduled Task (Application → Scheduled Tasks → Add):
 *       Name      : credits-refresh
 *       Frequency : * * * * *
 *       Command   : wget --header="Authorization: Bearer $CRON_SECRET" --post-data="" -qO- http://localhost:3000/api/cron/credits
 *     The command runs inside the app container: localhost:3000 reaches this service
 *     directly and $CRON_SECRET is read from the container's own environment, so the
 *     secret never leaves the container nor travels the public internet.
 *
 *   - On Vercel, trigger this route from vercel.json's crons config instead (Vercel
 *     Cron only sends GET, so proxy it into a Bearer-carrying POST or adapt the auth
 *     yourself); same principle.
 *
 * Notes:
 *   - Runs once a minute (UTC by default), 60s time budget per run. The scheduler judges
 *     timing in UTC, batch-settles due annual monthly drips (max 100 per tick) and
 *     reconciles overdue unrenewed subscriptions (max 20 per tick). Backlogs drain
 *     automatically on subsequent ticks.
 *   - No cross-tick lock: a slow tick overlapping the next one is harmless — drip
 *     settlement serializes on the subscription row lock and re-checks under it, and
 *     reconciliation replays into idempotent fulfillment. A single failure likewise
 *     self-heals and converges on the next minute's run.
 *   - POST /api/cron/credits is the real scheduling entry point; it requires Bearer
 *     CRON_SECRET and returns { ok: true, at, drip, renewals, pendingCaptures }.
 *   - GET /api/cron/credits is a health check only: it settles nothing, needs no auth,
 *     and returns { ok: true, status: 'healthy' }.
 *   - Manual trigger: curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *       http://localhost:3000/api/cron/credits
 * ============================================================================
 */

import {
  reconcileOverdueRenewals,
  reconcilePendingPayPalCaptures,
} from '@/lib/billing/reconcile';
import { settleDueDripGrantsBatch } from '@/lib/credits';
import { getLogger } from '@/lib/logger';
import { NextResponse } from 'next/server';

const logger = getLogger('billing.credits-cron')

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Per-tick caps. Drip settlement is two indexed queries plus one short
// transaction per row; reconciliation costs a provider API round-trip per
// row, so those caps are deliberately smaller. Backlogs drain across ticks.
const DRIP_BATCH_SIZE = 100
const RENEWAL_BATCH_SIZE = 20
const PENDING_CAPTURE_BATCH_SIZE = 20

function requireCronAuth(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

// GET: health check only, no auth required.
export async function GET() {
  return NextResponse.json({ ok: true, status: 'healthy' }, { status: 200 })
}

// POST: actual cron trigger, requires CRON_SECRET.
// No cross-tick lock: a slow tick overlapping the next one is harmless —
// drip settlement serializes on the subscription row lock and re-checks
// under it, and reconciliation replays into idempotent fulfillment.
export async function POST(request: Request) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  let stage = 'drip'
  try {
    const drip = await settleDueDripGrantsBatch(DRIP_BATCH_SIZE)
    stage = 'renewals'
    const renewals = await reconcileOverdueRenewals(RENEWAL_BATCH_SIZE)
    stage = 'pending-captures'
    const pendingCaptures = await reconcilePendingPayPalCaptures(
      PENDING_CAPTURE_BATCH_SIZE
    )

    return NextResponse.json({
      ok: true,
      at: new Date().toISOString(),
      drip,
      renewals,
      pendingCaptures,
    })
  } catch (error) {
    logger.error(
      { err: error, stage },
      'Credits cron reconciliation failed.'
    )
    return NextResponse.json(
      { ok: false, error: 'Credits reconciliation failed.' },
      { status: 500 }
    )
  }
}
