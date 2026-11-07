import type { CommerceRuntime } from "./context.js";
import { resetSubscriptionIn } from "./credits.js";
import { sanitizeLogError } from "./privacy.js";
import type { CommerceUnit } from "./store.js";
import { GRANTABLE_SUBSCRIPTION_STATUSES, type CreditSubject } from "./types.js";

/** Month addition that keeps the anniversary day. Never chain this to schedule later grants. */
export function addMonthsClamped(date: Date, months: number): Date {
  const next = new Date(date);
  const anchorDay = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(anchorDay, lastDay));
  return next;
}

export function grantWindowStartAt(interval: "month" | "year", anchor: Date | null, now: Date): Date | null {
  if (!anchor || anchor > now) return null;
  if (interval === "month") return anchor;
  let start = anchor;
  for (let k = 1; k < 12; k += 1) {
    const next = addMonthsClamped(anchor, k);
    if (next > now) break;
    start = next;
  }
  return start;
}

export function remainingWindowFraction(
  interval: "month" | "year",
  periodStart: Date | null,
  periodEnd: Date | null,
  now: Date,
): number {
  if (!periodStart) return 1;
  let start = periodStart;
  let end = periodEnd;
  if (interval === "year") {
    for (let k = 0; k < 12; k += 1) {
      const monthStart = addMonthsClamped(periodStart, k);
      const monthEnd = addMonthsClamped(periodStart, k + 1);
      if (now < monthEnd) {
        start = monthStart;
        end = monthEnd;
        break;
      }
    }
  }
  if (!end || end <= start) return 1;
  const fraction = (end.getTime() - now.getTime()) / (end.getTime() - start.getTime());
  return Math.min(1, Math.max(0, fraction));
}

export async function settleDripIn(rt: CommerceRuntime, unit: CommerceUnit, subscriptionId: string): Promise<boolean> {
  const now = rt.deps.clock.now();
  const sub = await unit.subscriptions.lockByLocalId(subscriptionId);
  if (!sub || sub.remainingGrants <= 0 || !sub.nextGrantAt || sub.nextGrantAt > now || !GRANTABLE_SUBSCRIPTION_STATUSES.includes(sub.status)) {
    return false;
  }
  const anchor = sub.currentPeriodStart;
  let remaining = sub.remainingGrants;
  let nextGrantAt: Date | null = sub.nextGrantAt;
  let periodStart = sub.nextGrantAt;
  let elapsed = 0;
  while (remaining > 0 && nextGrantAt && nextGrantAt <= now) {
    periodStart = nextGrantAt;
    elapsed += 1;
    remaining -= 1;
    nextGrantAt = remaining > 0
      ? anchor ? addMonthsClamped(anchor, 12 - remaining) : addMonthsClamped(nextGrantAt, 1)
      : null;
  }
  const at = rt.deps.clock.now();
  await unit.subscriptions.update(sub.provider, sub.providerSubscriptionId, { remainingGrants: remaining, nextGrantAt, updatedAt: at });
  await resetSubscriptionIn(rt, unit, {
    userId: sub.userId,
    organizationId: sub.organizationId,
    amount: sub.monthlyCredits,
    note: `Yearly plan monthly credits (period starting ${periodStart.toISOString().slice(0, 10)}, ${elapsed > 1 ? `${elapsed} periods elapsed, ` : ""}plan ${sub.planId})`,
  });
  return true;
}

export async function settleDueIn(rt: CommerceRuntime, unit: CommerceUnit, subject: CreditSubject): Promise<void> {
  const due = await unit.subscriptions.listDueDrips(rt.deps.clock.now(), subject);
  for (const row of due) await settleDripIn(rt, unit, row.id);
}

/**
 * Unbound lazy settlement. The due-id probe commits before any grant, and each
 * subscription then settles in its own transaction. One failure keeps the
 * grants that already committed. Callers that already hold a unit use
 * `settleDueIn` so the probe, grants, and the following spend stay together.
 */
export async function settleDueApart(rt: CommerceRuntime, subject: CreditSubject): Promise<void> {
  const due = await rt.withUnit(undefined, (unit) => unit.subscriptions.listDueDrips(rt.deps.clock.now(), subject));
  for (const row of due) {
    await rt.withUnit(undefined, (unit) => settleDripIn(rt, unit, row.id));
  }
}

export async function settleBatch(rt: CommerceRuntime, limit: number): Promise<{ due: number; settled: number; failed: number }> {
  const due = await rt.withUnit(undefined, (unit) => unit.subscriptions.listDueDrips(rt.deps.clock.now(), undefined, limit));
  let settled = 0;
  let failed = 0;
  for (const row of due) {
    try {
      if (await rt.withUnit(undefined, (unit) => settleDripIn(rt, unit, row.id))) settled += 1;
    } catch (error) {
      failed += 1;
      const safe = error instanceof Error ? sanitizeLogError(error) : error;
      rt.log("error", { subscriptionId: row.id, err: safe }, "settleDueDripGrantsBatch failed");
    }
  }
  return { due: due.length, settled, failed };
}
