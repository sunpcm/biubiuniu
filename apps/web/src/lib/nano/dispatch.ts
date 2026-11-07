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
        return await coordinator.markUnknown(task.id, claim);
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
): Promise<number> {
  const stale = await coordinator.listStaleInFlight(now, limit);
  for (const task of stale) {
    try {
      await coordinator.markUnknown(task.id);
    } catch {
      // Already terminal or lost a race; both are safe.
    }
  }
  return stale.length;
}
