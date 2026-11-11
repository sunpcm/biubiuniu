/**
 * Nano persistent-task core.
 *
 * Pure domain: no Drizzle handle, no provider SDK, no `process.env`, no React,
 * no Next. The PG coordinator owns the database transaction and passes this
 * module a `NanoUnit` (task repository + the CommerceBound of the same owned
 * unit). The provider is invoked only after the admit transaction commits.
 *
 * A `NanoClaim` is the fencing token that serializes dispatch and terminal
 * transitions. Only the scanner that won `markLeased` holds a claim for a task,
 * and every downstream state change (dispatch/running/stage/terminal) must
 * present the same owner+token. Claim-less terminal transitions are reserved
 * for recovery of a persisted result (`resultRef IS NOT NULL`) or of a lost
 * in-flight row (`resultRef IS NULL`), never for a fresh paid re-submit.
 */
import type { CommerceBound } from "@sunpcm/niu-commerce";
import {
  NanoIdempotencyConflictError,
  NanoInvalidInputError,
  NanoInvalidStateError,
  NanoTaskNotFoundError,
} from "./errors.js";

export type NanoTaskStatus =
  | "queued"
  | "leased"
  | "dispatching"
  | "running"
  | "unknown"
  | "succeeded"
  | "failed"
  | "canceled";

export const ACTIVE_NANO_STATUSES: readonly NanoTaskStatus[] = [
  "queued",
  "leased",
  "dispatching",
  "running",
  "unknown",
];

export const TERMINAL_NANO_STATUSES: readonly NanoTaskStatus[] = [
  "succeeded",
  "failed",
  "canceled",
];

/** The balance-owning subject. Exactly one of `userId`/`organizationId` is set. */
export interface NanoSubject {
  userId: string | null;
  organizationId: string | null;
}

/**
 * Dispatch/terminal fencing claim. `leaseOwner` is a per-process instance id;
 * `leaseToken` is a per-attempt random token so an old owner cannot mutate a
 * task it no longer owns.
 */
export interface NanoClaim {
  leaseOwner: string;
  leaseToken: string;
}

/**
 * Persisted request reference. Carries the actual input needed to re-dispatch a
 * queued task after a process restart (image bytes are base64, never logged).
 */
export interface NanoInputRef {
  prompt: string;
  imageData: string | null;
  mimeType: string | null;
}

export interface NanoTask {
  id: string;
  productId: string;
  subjectKey: string;
  subject: NanoSubject;
  feature: string;
  requestKey: string;
  contentSummary: string;
  inputRef: NanoInputRef | null;
  status: NanoTaskStatus;
  cost: number;
  spendTxId: string | null;
  providerRequestKey: string | null;
  providerTaskId: string | null;
  resultRef: string | null;
  resultSummary: string | null;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NanoAdmitInput {
  productId: string;
  /** Balance-owning subject. */
  subject: NanoSubject;
  /** Authenticated session user; for org tasks this is the live member. */
  actorUserId: string;
  feature: string;
  requestKey: string;
  contentSummary: string;
  cost: number;
  inputRef: NanoInputRef;
}

export interface NanoAdmitResult {
  task: NanoTask;
  created: boolean;
}

export interface NanoCase {
  id: string;
  name: string;
}

/** Product-injected allowlist. The shared package only constrains the shape. */
export interface NanoCaseCatalog {
  has(caseId: string): boolean;
  ids(): readonly string[];
}

export interface NanoTaskRepository {
  insertAdmitted(
    input: NanoAdmitInput & { status: NanoTaskStatus },
  ): Promise<{ task: NanoTask; inserted: boolean }>;
  attachSpendTxId(id: string, spendTxId: string): Promise<void>;
  insertActiveJob(taskId: string, subject: NanoSubject): Promise<void>;
  loadById(id: string): Promise<NanoTask | null>;
  transitionToSucceeded(
    id: string,
    resultRef: string,
    resultSummary: string,
    claim: NanoClaim | null,
  ): Promise<NanoTask | null>;
  transitionToFailed(id: string, claim: NanoClaim | null): Promise<NanoTask | null>;
  transitionToCanceled(id: string): Promise<NanoTask | null>;
  transitionToUnknown(id: string, claim: NanoClaim | null): Promise<NanoTask | null>;
  /**
   * Claim-less CAS for the unknown-expiry policy: `unknown` with no persisted
   * result and `updatedAt <= enteredBefore` becomes `failed`, the lease is
   * cleared so a late owner can no longer match, and the active job is
   * released. Returns null when the row no longer matches.
   */
  expireUnknown(id: string, enteredBefore: Date): Promise<NanoTask | null>;
  /** Ids of `unknown` rows without a result that entered `unknown` at or before the cutoff. */
  listExpiredUnknown(enteredBefore: Date, limit: number): Promise<string[]>;
  stageResult(
    id: string,
    resultRef: string,
    resultSummary: string,
    claim: NanoClaim,
  ): Promise<NanoTask | null>;
  listDispatchable(now: Date, limit: number): Promise<NanoTask[]>;
  listStaleInFlight(now: Date, limit: number): Promise<NanoTask[]>;
  listStaged(now: Date, limit: number): Promise<NanoTask[]>;
  listBySubject(
    subjectKey: string,
    input: { cursor: { createdAt: Date; id: string } | null; limit: number },
  ): Promise<{ tasks: NanoTask[]; nextCursor: { createdAt: Date; id: string } | null }>;
  markLeased(id: string, claim: NanoClaim, leaseUntil: Date): Promise<NanoTask | null>;
  markDispatching(id: string, providerRequestKey: string, claim: NanoClaim): Promise<NanoTask | null>;
  markRunning(id: string, providerTaskId: string, claim: NanoClaim): Promise<NanoTask | null>;
  recordCaseSelection(input: {
    productId: string;
    caseId: string;
    requestKey: string;
    userId: string;
    selectedAt: Date;
  }): Promise<{ recorded: boolean }>;
  caseStatsSince(since: Date): Promise<Record<string, number>>;
}

export interface NanoUnit {
  tasks: NanoTaskRepository;
  commerce: CommerceBound;
}

export function nanoSubjectKey(subject: NanoSubject): string {
  assertValidSubject(subject);
  if (subject.organizationId) return `org:${subject.organizationId}`;
  if (subject.userId) return `user:${subject.userId}`;
  throw new NanoInvalidInputError(
    "Nano subject requires exactly one of userId or organizationId",
  );
}

function assertValidSubject(subject: NanoSubject): void {
  const hasUser = !!subject.userId;
  const hasOrg = !!subject.organizationId;
  if (hasUser === hasOrg) {
    throw new NanoInvalidInputError(
      "Nano subject requires exactly one of userId or organizationId",
    );
  }
}

function assertPositiveCost(cost: number): void {
  if (!Number.isSafeInteger(cost) || cost <= 0) {
    throw new NanoInvalidInputError("Nano cost must be a positive safe integer");
  }
}

export function isTerminal(status: NanoTaskStatus): boolean {
  return (TERMINAL_NANO_STATUSES as readonly string[]).includes(status);
}

export function isActive(status: NanoTaskStatus): boolean {
  return (ACTIVE_NANO_STATUSES as readonly string[]).includes(status);
}

export type DispatchDecision = "dispatch" | "unknown" | "skip";

/**
 * Recovery/dispatch decision for a persisted task. A stale lease on a task that
 * already left `queued` must NOT blindly re-submit a paid provider call; it is
 * surfaced as `unknown` for reconciliation unless a provider idempotency/query
 * contract is verified (Google image generation has none).
 */
export function dispatchDecision(task: NanoTask, now: Date): DispatchDecision {
  if (isTerminal(task.status) || task.status === "unknown") return "skip";
  if (task.status === "queued") return "dispatch";
  if (task.status === "leased") {
    return !task.leaseUntil || task.leaseUntil.getTime() <= now.getTime() ? "dispatch" : "skip";
  }
  if (task.status === "dispatching" || task.status === "running") {
    return !task.leaseUntil || task.leaseUntil.getTime() <= now.getTime() ? "unknown" : "skip";
  }
  return "skip";
}

/**
 * Admit a Nano task: idempotency check, original credit spend, spendTxId
 * association, and a scannable dispatch intent all happen inside the caller's
 * single owned transaction. Same key + same content returns the existing task
 * without a second spend; same key + different content conflicts with no spend.
 */
export async function admitTask(unit: NanoUnit, input: NanoAdmitInput): Promise<NanoAdmitResult> {
  assertValidSubject(input.subject);
  assertPositiveCost(input.cost);

  const { task: inserted, inserted: didInsert } = await unit.tasks.insertAdmitted({
    ...input,
    status: "queued",
  });
  if (!didInsert) {
    if (inserted.contentSummary !== input.contentSummary) {
      throw new NanoIdempotencyConflictError();
    }
    return { task: inserted, created: false };
  }

  const spend = await unit.commerce.spendCredits({
    userId: input.actorUserId,
    organizationId: input.subject.organizationId,
    amount: input.cost,
    note: `nano:${input.feature}`,
  });
  await unit.tasks.attachSpendTxId(inserted.id, spend.txId);
  await unit.tasks.insertActiveJob(inserted.id, input.subject);
  return { task: { ...inserted, spendTxId: spend.txId }, created: true };
}

/**
 * Complete a task. With a claim this is the normal dispatch path (fresh result);
 * without a claim it finalizes a previously staged result (recovery), and the
 * repository only allows that when `resultRef` is already persisted, so it can
 * never invent a success for an un-staged task.
 */
export async function completeTask(
  unit: NanoUnit,
  taskId: string,
  result: { resultRef: string; resultSummary: string },
  claim: NanoClaim | null = null,
): Promise<NanoTask> {
  const task = await unit.tasks.loadById(taskId);
  if (!task) throw new NanoTaskNotFoundError();
  if (isTerminal(task.status)) return task;
  const updated = await unit.tasks.transitionToSucceeded(
    taskId,
    result.resultRef,
    result.resultSummary,
    claim,
  );
  if (!updated) throw new NanoInvalidStateError(`Cannot complete nano task in state ${task.status}`);
  return updated;
}

/**
 * Fail a task. The transition is the serialization point: refund happens only
 * after a successful CAS to `failed`, so a racing success/fail can never leave
 * a `succeeded` result plus a refund.
 */
export async function failTask(
  unit: NanoUnit,
  taskId: string,
  claim: NanoClaim | null = null,
): Promise<NanoTask> {
  const task = await unit.tasks.loadById(taskId);
  if (!task) throw new NanoTaskNotFoundError();
  if (isTerminal(task.status)) return task;

  const updated = await unit.tasks.transitionToFailed(taskId, claim);
  if (!updated) throw new NanoInvalidStateError(`Cannot fail nano task in state ${task.status}`);
  if (updated.spendTxId) {
    await unit.commerce.refundSpentCredits({
      spendTxId: updated.spendTxId,
      note: `nano-refund:${updated.feature}`,
    });
  }
  return updated;
}

/**
 * Cancel a queued task. The CAS to `canceled` from `queued` is the serialization
 * point: only when it wins do we refund, so a racing lease/dispatch claim wins
 * and the cancel neither refunds nor pretends the remote was cancelled.
 */
export async function cancelTask(unit: NanoUnit, taskId: string): Promise<NanoTask> {
  const task = await unit.tasks.loadById(taskId);
  if (!task) throw new NanoTaskNotFoundError();
  if (isTerminal(task.status)) return task;

  const updated = await unit.tasks.transitionToCanceled(taskId);
  if (!updated) throw new NanoInvalidStateError(`Cannot cancel nano task in state ${task.status}`);
  if (updated.spendTxId) {
    await unit.commerce.refundSpentCredits({
      spendTxId: updated.spendTxId,
      note: `nano-cancel:${updated.feature}`,
    });
  }
  return updated;
}

/**
 * Mark an in-flight task unknown. With a claim this is the provider
 * "uncertain failure" path; without a claim it is stale-in-flight recovery and
 * only matches rows that have no persisted result.
 */
export async function markUnknown(
  unit: NanoUnit,
  taskId: string,
  claim: NanoClaim | null = null,
): Promise<NanoTask> {
  const task = await unit.tasks.loadById(taskId);
  if (!task) throw new NanoTaskNotFoundError();
  if (isTerminal(task.status) || task.status === "unknown") return task;
  const updated = await unit.tasks.transitionToUnknown(taskId, claim);
  if (!updated) throw new NanoInvalidStateError(`Cannot mark unknown nano task in state ${task.status}`);
  return updated;
}

export interface NanoExpireUnknownResult {
  task: NanoTask;
  /** True only for the caller whose CAS moved the task to `failed` and refunded it. */
  refunded: boolean;
}

/**
 * Unknown-expiry policy: a task that has stayed `unknown` (no persisted result)
 * since `enteredBefore` is settled as `failed` and its original spend is
 * refunded in the same transaction. The CAS is the serialization point, so
 * concurrent sweepers refund at most once; a late result for the same task can
 * no longer be staged because `failed` is not stageable. A task that is
 * terminal, not `unknown`, already staged, or not old enough is returned
 * unchanged with `refunded: false`.
 */
export async function expireUnknownTask(
  unit: NanoUnit,
  taskId: string,
  enteredBefore: Date,
): Promise<NanoExpireUnknownResult> {
  const task = await unit.tasks.loadById(taskId);
  if (!task) throw new NanoTaskNotFoundError();
  if (task.status !== "unknown" || task.resultRef) return { task, refunded: false };

  const updated = await unit.tasks.expireUnknown(taskId, enteredBefore);
  if (!updated) {
    return { task: (await unit.tasks.loadById(taskId)) ?? task, refunded: false };
  }
  if (updated.spendTxId) {
    await unit.commerce.refundSpentCredits({
      spendTxId: updated.spendTxId,
      note: `nano-unknown-refund:${updated.feature}`,
    });
  }
  return { task: updated, refunded: true };
}
