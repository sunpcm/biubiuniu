import { RefundHistoryIncompleteError } from "./errors.js";
import type { OrderRow } from "./store.js";
import type { RefundInput } from "./types.js";

type RefundLedger = { mode: "cumulative"; ids: string[] } | { mode: "events"; entries: Record<string, number> };

export function plainMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

export function readRefundLedger(metadata: Record<string, unknown>): RefundLedger | null {
  const raw = metadata.refundLedger;
  if (raw == null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RefundHistoryIncompleteError("Persisted refund ledger is not an object");
  }
  const ledger = raw as Record<string, unknown>;
  if (ledger.mode === "cumulative") {
    if (!Array.isArray(ledger.ids) || ledger.ids.some((id) => typeof id !== "string" || !id)) {
      throw new RefundHistoryIncompleteError("Persisted cumulative refund ledger has no stable ids");
    }
    return { mode: "cumulative", ids: [...ledger.ids] };
  }
  if (ledger.mode === "events") {
    if (!ledger.entries || typeof ledger.entries !== "object" || Array.isArray(ledger.entries)) {
      throw new RefundHistoryIncompleteError("Persisted refund event ledger is incomplete");
    }
    const entries: Record<string, number> = {};
    for (const [id, amount] of Object.entries(ledger.entries as Record<string, unknown>)) {
      if (!id || typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) {
        throw new RefundHistoryIncompleteError("Persisted refund ledger entry is not a safe amount");
      }
      entries[id] = amount;
    }
    return { mode: "events", entries };
  }
  throw new RefundHistoryIncompleteError("Persisted refund ledger mode is not recognized");
}

export type RefundDecision =
  | { kind: "noop" }
  | { kind: "metadata"; metadata: Record<string, unknown> }
  | {
      kind: "advance";
      refundedTotal: number;
      refundDelta: number;
      creditsToRevoke: number;
      full: boolean;
      metadata: Record<string, unknown>;
      stopDrip: boolean;
    };

export function decideRefundAdvance(order: OrderRow, input: RefundInput): RefundDecision {
  const metadata = plainMetadata(order.metadata);
  const ledger = readRefundLedger(metadata);
  const cumulative = input.cumulative !== false;
  const refundId = input.refundId == null ? null : input.refundId.trim();
  if (input.refundId != null && !refundId) throw new RefundHistoryIncompleteError("Refund id is blank");
  let refundedTotal = input.amountRefunded;
  let nextLedger: RefundLedger | null = ledger;

  if (!cumulative) {
    if (!refundId) {
      throw new RefundHistoryIncompleteError("Refund event has no stable refund id and no official cumulative total");
    }
    if (ledger?.mode === "cumulative") {
      if (ledger.ids.includes(refundId)) return { kind: "noop" };
      throw new RefundHistoryIncompleteError("Refund history is an official cumulative total and this event has no cumulative total; refusing to add an unverified delta");
    }
    const entries = ledger?.mode === "events" ? { ...ledger.entries } : null;
    if (entries && refundId in entries) {
      if (entries[refundId] !== input.amountRefunded) {
        throw new RefundHistoryIncompleteError(`Refund ${refundId} amount conflicts with the persisted ledger`);
      }
      return { kind: "noop" };
    }
    if (!entries) {
      if (order.amountRefunded !== 0) {
        throw new RefundHistoryIncompleteError("Historical refunded amount has no complete refund ids; refusing an unknown delta even when the amount matches");
      }
      nextLedger = { mode: "events", entries: { [refundId]: input.amountRefunded } };
      refundedTotal = input.amountRefunded;
    } else {
      const known = Object.values(entries).reduce((sum, amount) => sum + amount, 0);
      if (known !== order.amountRefunded) {
        throw new RefundHistoryIncompleteError("Persisted refund ledger does not match amount_refunded");
      }
      entries[refundId] = input.amountRefunded;
      const total = known + input.amountRefunded;
      if (!Number.isSafeInteger(total)) throw new RefundHistoryIncompleteError("Refund total is not a safe integer");
      nextLedger = { mode: "events", entries };
      refundedTotal = total;
    }
  } else if (input.amountRefunded <= order.amountRefunded) {
    return { kind: "noop" };
  } else {
    const priorIds = ledger?.mode === "cumulative" ? ledger.ids : ledger?.mode === "events" ? Object.keys(ledger.entries) : [];
    nextLedger = { mode: "cumulative", ids: refundId ? [...new Set([...priorIds, refundId])] : [...priorIds] };
    refundedTotal = input.amountRefunded;
  }

  if (refundedTotal === order.amountRefunded) {
    return { kind: "metadata", metadata: { ...metadata, refundLedger: nextLedger } };
  }
  if (refundedTotal < order.amountRefunded) return { kind: "noop" };
  if (refundedTotal > order.amountTotal) {
    throw new Error(`Refund amount ${refundedTotal} exceeds order total ${order.amountTotal} for ${input.provider}/${order.id}`);
  }
  const full = refundedTotal >= order.amountTotal;
  const totalCredits = order.amountTotal > 0 ? Math.round((order.creditsGranted * refundedTotal) / order.amountTotal) : 0;
  const already = order.amountTotal > 0 ? Math.round((order.creditsGranted * order.amountRefunded) / order.amountTotal) : 0;
  return {
    kind: "advance",
    refundedTotal,
    refundDelta: refundedTotal - order.amountRefunded,
    creditsToRevoke: Math.max(0, totalCredits - already),
    full,
    metadata: { ...metadata, refundLedger: nextLedger },
    stopDrip: full && (order.orderType === "subscription_initial" || order.orderType === "subscription_renewal") && !!order.providerSubscriptionId,
  };
}
