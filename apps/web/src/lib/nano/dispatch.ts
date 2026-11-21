import { randomUUID } from "node:crypto";
import {
  NanoProviderError,
  dispatchDecision,
  type NanoClaim,
  type NanoProvider,
  type NanoTask,
} from "@sunpcm/niu-feature-nano";
import type { NanoCoordinator } from "@sunpcm/niu-persistence-pg/nano";
import { serializeProviderResult } from "./dto";

/**
 * Dispatch orchestration for the in-process sweeper.
 *
 * The provider call runs strictly between short DB writes (lease/dispatch and
 * terminalization), so no transaction is held across a remote call. A claim
 * token is generated for every attempt and every downstream write re-verifies
 * owner+token before advancing state, so an expired lease or a racing scanner
 * cannot double-pay or overwrite a terminal decision.
 */
export interface NanoDispatchConfig {
  owner: string;
  leaseMs: number;
  model: string;
  batchSize: number;
  maxConcurrent: number;
  /**
   * Shutdown gate. Once it returns true no new task is leased: the current
   * batch finishes its in-flight provider calls, later batches are skipped.
   */
  shouldStop?: () => boolean;
  /** Called after a task was durably marked `unknown` by this dispatcher. */
  onUnknown?: (event: NanoUnknownEvent) => void;
}

export interface NanoUnknownEvent {
  taskId: string;
  /** `provider`: uncertain provider failure; `stale`: lease expired with no result. */
  reason: "provider" | "stale";
}

export interface NanoUnknownRefundedEvent {
  taskId: string;
  cost: number;
}

export function createNanoClaim(owner: string): NanoClaim {
  return { leaseOwner: owner, leaseToken: randomUUID() };
}

export async function dispatchOne(
  coordinator: NanoCoordinator,
  provider: NanoProvider,
  task: NanoTask,
  config: NanoDispatchConfig,
): Promise<NanoTask> {
  const now = new Date();
  if (config.shouldStop?.()) return task;
  if (dispatchDecision(task, now) !== "dispatch") return task;

  const claim = createNanoClaim(config.owner);
  const leaseUntil = new Date(now.getTime() + config.leaseMs);

  const leased = await coordinator.markLeased(task.id, claim, leaseUntil);
  if (!leased) return task;

  const dispatching = await coordinator.markDispatching(task.id, task.requestKey, claim);
  if (!dispatching) return task;

  let result;
  try {
    result = await provider.generate({
      prompt: task.inputRef?.prompt ?? "",
      imageData: task.inputRef?.imageData ?? null,
      mimeType: task.inputRef?.mimeType ?? null,
      model: config.model,
    });
  } catch (error) {
    if (error instanceof NanoProviderError && error.unknown) {
      try {
        const unknown = await coordinator.markUnknown(task.id, claim);
        if (unknown.status === "unknown") {
          config.onUnknown?.({ taskId: task.id, reason: "provider" });
        }
        return unknown;
      } catch {
        return (await coordinator.get(task.id)) ?? task;
      }
    }
    // Determinate provider failure: transition (claim-validated) first, then
    // refund only if that transition won. `coordinator.fail` does both inside
    // one transaction.
    return await coordinator.fail(task.id, claim);
  }

  const { resultRef, resultSummary } = serializeProviderResult(result);
  const staged = await coordinator.stageResult(task.id, resultRef, resultSummary, claim);
  if (!staged) {
    // The claim was lost (expired lease / another owner) after the remote
    // already accepted work. Never refund here: the task is left for stale
    // recovery (unknown if no result, staged finalization if persisted).
    return (await coordinator.get(task.id)) ?? task;
  }
  return await coordinator.complete(task.id, { resultRef, resultSummary }, claim);
}

export async function sweepDispatchable(
  coordinator: NanoCoordinator,
  provider: NanoProvider,
  config: NanoDispatchConfig,
  now = new Date(),
): Promise<number> {
  const tasks = await coordinator.listDispatchable(now, config.batchSize);
  for (let i = 0; i < tasks.length; i += config.maxConcurrent) {
    if (config.shouldStop?.()) break;
    const batch = tasks.slice(i, i + config.maxConcurrent);
    await Promise.all(batch.map((task) => dispatchOne(coordinator, provider, task, config)));
  }
  return tasks.length;
}

/** Finalize staged results left behind by a crashed owner (no provider re-call). */
export async function sweepStaged(
  coordinator: NanoCoordinator,
  now = new Date(),
  limit = 100,
): Promise<number> {
  const staged = await coordinator.listStaged(now, limit);
  for (const task of staged) {
    try {
      await coordinator.complete(
        task.id,
        { resultRef: task.resultRef ?? "", resultSummary: task.resultSummary ?? "" },
        null,
      );
    } catch {
      // Already terminal or lost a race to another scanner; both are safe.
    }
  }
  return staged.length;
}

/** Mark stale in-flight rows (no persisted result) unknown, never blindly re-send. */
export async function sweepStaleInFlight(
  coordinator: NanoCoordinator,
  now = new Date(),
  limit = 100,
  onUnknown?: (event: NanoUnknownEvent) => void,
): Promise<number> {
  const stale = await coordinator.listStaleInFlight(now, limit);
  for (const task of stale) {
    try {
      const updated = await coordinator.markUnknown(task.id);
      if (updated.status === "unknown") onUnknown?.({ taskId: task.id, reason: "stale" });
    } catch {
      // Already terminal or lost a race; both are safe.
    }
  }
  return stale.length;
}

/**
 * Unknown-expiry policy. A task that has stayed `unknown` with no persisted
 * result for `refundAfterMs` is settled as `failed` and its spend is refunded
 * in one transaction (`coordinator.expireUnknown`). This is the only automatic
 * exit for an `unknown` whose owner is gone or whose provider outcome was
 * uncertain; it also releases the active job that blocks account deletion.
 * Returns the number of tasks this call refunded.
 */
export async function sweepExpiredUnknown(
  coordinator: NanoCoordinator,
  refundAfterMs: number,
  now = new Date(),
  limit = 100,
  onRefunded?: (event: NanoUnknownRefundedEvent) => void,
): Promise<number> {
  const enteredBefore = new Date(now.getTime() - refundAfterMs);
  const ids = await coordinator.listExpiredUnknown(enteredBefore, limit);
  let refunded = 0;
  for (const id of ids) {
    try {
      const result = await coordinator.expireUnknown(id, enteredBefore);
      if (result.refunded) {
        refunded += 1;
        onRefunded?.({ taskId: id, cost: result.task.cost });
      }
    } catch {
      // Lost a race or a transient database error; the next sweep retries.
    }
  }
  return refunded;
}
