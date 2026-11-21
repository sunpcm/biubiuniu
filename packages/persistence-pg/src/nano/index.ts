/**
 * PostgreSQL Nano adapter.
 *
 * The coordinator owns the transaction seam: it reuses the N3
 * `coordinatePgCommerce(store, commerce, ({ handle, unit }) => ...)` entry and
 * constructs the Nano repository on `handle` plus `commerce.join(unit)`. The
 * core (`@sunpcm/niu-feature-nano`) never receives a Drizzle handle; it only
 * sees the `NanoUnit` (repository + the same-transaction CommerceBound).
 *
 * Every repository is bound to a single `productId`. All reads, writes, lease
 * claims, scans, and case aggregations are product-scoped so two instances
 * pointing at the same database cannot cross product boundaries.
 *
 * Lease/dispatch/terminal transitions are compare-and-swap on status plus the
 * owner/token claim, so only the scanner that won `markLeased` can advance a
 * task, and an expired owner can no longer overwrite cancel/terminal state.
 */
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  NanoInvalidInputError,
  admitTask,
  cancelTask,
  completeTask,
  expireUnknownTask,
  failTask,
  markUnknown,
  nanoSubjectKey,
  type NanoAdmitInput,
  type NanoClaim,
  type NanoInputRef,
  type NanoSubject,
  type NanoTask,
  type NanoTaskRepository,
  type NanoTaskStatus,
  type NanoAdmitResult,
  type NanoExpireUnknownResult,
} from "@sunpcm/niu-feature-nano";
import type { Commerce } from "@sunpcm/niu-commerce";
import { coordinatePgCommerce, type PgCommerceStore } from "../commerce/index.js";
import {
  nanoActiveJobs,
  nanoCaseSelections,
  nanoTasks,
  type NanoTaskRow,
} from "../schema/nano.js";

type NanoDb = Pick<
  PostgresJsDatabase<Record<string, unknown>>,
  "select" | "insert" | "update" | "delete"
>;

const IN_FLIGHT_STATUSES = ["dispatching", "running"] as const;
const TERMINAL_FROM_STATUSES = ["queued", "leased", "dispatching", "running", "unknown"] as const;
const STAGEABLE_STATUSES = ["dispatching", "running", "unknown"] as const;

/**
 * Column projections. `input_ref` carries the uploaded image (base64, up to
 * several MB) and `result_ref` the generated images, so reads that do not need
 * them must not pull them across the wire:
 * - `TASK_WITHOUT_INPUT` — status/result reads and lease transitions;
 * - `TASK_SUMMARY` — listings and scans that need neither payload.
 * `mapTask` reports an unselected payload column as `null`.
 */
const { inputRef: _inputRefColumn, ...TASK_WITHOUT_INPUT } = getTableColumns(nanoTasks);
const { resultRef: _resultRefColumn, ...TASK_SUMMARY } = TASK_WITHOUT_INPUT;

type NanoTaskProjection = Omit<NanoTaskRow, "inputRef" | "resultRef"> &
  Partial<Pick<NanoTaskRow, "inputRef" | "resultRef">>;

function mapTask(row: NanoTaskProjection): NanoTask {
  return {
    id: row.id,
    productId: row.productId,
    subjectKey: row.subjectKey,
    subject: { userId: row.userId, organizationId: row.organizationId },
    feature: row.feature,
    requestKey: row.requestKey,
    contentSummary: row.contentSummary,
    inputRef: (row.inputRef as NanoInputRef | null) ?? null,
    status: row.status as NanoTaskStatus,
    cost: row.cost,
    spendTxId: row.spendTxId,
    providerRequestKey: row.providerRequestKey,
    providerTaskId: row.providerTaskId,
    resultRef: row.resultRef ?? null,
    resultSummary: row.resultSummary,
    leaseOwner: row.leaseOwner,
    leaseToken: row.leaseToken,
    leaseUntil: row.leaseUntil,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function claimPredicate(claim: NanoClaim) {
  return and(eq(nanoTasks.leaseOwner, claim.leaseOwner), eq(nanoTasks.leaseToken, claim.leaseToken));
}

export function createNanoRepository(db: NanoDb, productId: string): NanoTaskRepository {
  const product = () => eq(nanoTasks.productId, productId);

  async function deleteActiveJob(taskId: string): Promise<void> {
    await db.delete(nanoActiveJobs).where(eq(nanoActiveJobs.taskId, taskId));
  }

  return {
    async insertAdmitted(input) {
      if (input.productId !== productId) {
        throw new NanoInvalidInputError("Nano admit productId does not match the bound product");
      }
      const subjectKey = nanoSubjectKey(input.subject);
      const [inserted] = await db
        .insert(nanoTasks)
        .values({
          productId: input.productId,
          subjectKey,
          feature: input.feature,
          requestKey: input.requestKey,
          contentSummary: input.contentSummary,
          inputRef: input.inputRef,
          status: input.status,
          cost: input.cost,
          userId: input.subject.userId,
          organizationId: input.subject.organizationId,
        })
        .onConflictDoNothing({
          target: [
            nanoTasks.productId,
            nanoTasks.subjectKey,
            nanoTasks.feature,
            nanoTasks.requestKey,
          ],
        })
        .returning();
      if (inserted) return { task: mapTask(inserted), inserted: true };
      const [existing] = await db
        .select()
        .from(nanoTasks)
        .where(
          and(
            eq(nanoTasks.productId, productId),
            eq(nanoTasks.subjectKey, subjectKey),
            eq(nanoTasks.feature, input.feature),
            eq(nanoTasks.requestKey, input.requestKey),
          ),
        )
        .limit(1);
      return { task: mapTask(existing), inserted: false };
    },

    async attachSpendTxId(id, spendTxId) {
      await db
        .update(nanoTasks)
        .set({ spendTxId, updatedAt: new Date() })
        .where(and(eq(nanoTasks.id, id), product()));
    },

    async insertActiveJob(taskId, subject: NanoSubject) {
      await db.insert(nanoActiveJobs).values({
        taskId,
        userId: subject.userId,
        organizationId: subject.organizationId,
      });
    },

    async loadById(id) {
      const [row] = await db
        .select()
        .from(nanoTasks)
        .where(and(eq(nanoTasks.id, id), product()))
        .limit(1);
      return row ? mapTask(row) : null;
    },

    async transitionToSucceeded(id, resultRef, resultSummary, claim) {
      const base = and(
        eq(nanoTasks.id, id),
        product(),
        inArray(nanoTasks.status, [...TERMINAL_FROM_STATUSES]),
      );
      const scope = claim ? claimPredicate(claim) : isNotNull(nanoTasks.resultRef);
      const set = claim
        ? { status: "succeeded" as const, resultRef, resultSummary, updatedAt: new Date() }
        : { status: "succeeded" as const, updatedAt: new Date() };
      const [row] = await db
        .update(nanoTasks)
        .set(set)
        .where(and(base, scope))
        .returning();
      if (!row) return null;
      await deleteActiveJob(id);
      return mapTask(row);
    },

    async transitionToFailed(id, claim) {
      if (!claim) return null;
      const [row] = await db
        .update(nanoTasks)
        .set({ status: "failed", updatedAt: new Date() })
        .where(
          and(
            eq(nanoTasks.id, id),
            product(),
            inArray(nanoTasks.status, [...TERMINAL_FROM_STATUSES]),
            claimPredicate(claim),
          ),
        )
        .returning();
      if (!row) return null;
      await deleteActiveJob(id);
      return mapTask(row);
    },

    async transitionToCanceled(id) {
      const [row] = await db
        .update(nanoTasks)
        .set({ status: "canceled", updatedAt: new Date() })
        .where(and(eq(nanoTasks.id, id), product(), eq(nanoTasks.status, "queued")))
        .returning();
      if (!row) return null;
      await deleteActiveJob(id);
      return mapTask(row);
    },

    async transitionToUnknown(id, claim) {
      const base = and(
        eq(nanoTasks.id, id),
        product(),
        inArray(nanoTasks.status, [...IN_FLIGHT_STATUSES]),
      );
      const scope = claim ? claimPredicate(claim) : isNull(nanoTasks.resultRef);
      const [row] = await db
        .update(nanoTasks)
        .set({ status: "unknown", updatedAt: new Date() })
        .where(and(base, scope))
        .returning(TASK_WITHOUT_INPUT);
      return row ? mapTask(row) : null;
    },

    async expireUnknown(id, enteredBefore) {
      const [row] = await db
        .update(nanoTasks)
        .set({ status: "failed", leaseOwner: null, leaseToken: null, updatedAt: new Date() })
        .where(
          and(
            eq(nanoTasks.id, id),
            product(),
            eq(nanoTasks.status, "unknown"),
            isNull(nanoTasks.resultRef),
            lte(nanoTasks.updatedAt, enteredBefore),
          ),
        )
        .returning(TASK_WITHOUT_INPUT);
      if (!row) return null;
      await deleteActiveJob(id);
      return mapTask(row);
    },

    async listExpiredUnknown(enteredBefore, limit) {
      const rows = await db
        .select({ id: nanoTasks.id })
        .from(nanoTasks)
        .where(
          and(
            product(),
            eq(nanoTasks.status, "unknown"),
            isNull(nanoTasks.resultRef),
            lte(nanoTasks.updatedAt, enteredBefore),
          ),
        )
        .orderBy(asc(nanoTasks.updatedAt))
        .limit(limit);
      return rows.map((row) => row.id);
    },

    async stageResult(id, resultRef, resultSummary, claim) {
      const [row] = await db
        .update(nanoTasks)
        .set({ resultRef, resultSummary, updatedAt: new Date() })
        .where(
          and(
            eq(nanoTasks.id, id),
            product(),
            inArray(nanoTasks.status, [...STAGEABLE_STATUSES]),
            claimPredicate(claim),
          ),
        )
        .returning();
      return row ? mapTask(row) : null;
    },

    async listDispatchable(now, limit) {
      const rows = await db
        .select()
        .from(nanoTasks)
        .where(
          and(
            product(),
            or(
              eq(nanoTasks.status, "queued"),
              and(
                eq(nanoTasks.status, "leased"),
                or(isNull(nanoTasks.leaseUntil), lte(nanoTasks.leaseUntil, now)),
              ),
            ),
          ),
        )
        .orderBy(asc(nanoTasks.createdAt))
        .limit(limit);
      return rows.map(mapTask);
    },

    async listStaleInFlight(now, limit) {
      const rows = await db
        .select(TASK_SUMMARY)
        .from(nanoTasks)
        .where(
          and(
            product(),
            inArray(nanoTasks.status, [...IN_FLIGHT_STATUSES]),
            lte(nanoTasks.leaseUntil, now),
            isNull(nanoTasks.resultRef),
          ),
        )
        .orderBy(asc(nanoTasks.createdAt))
        .limit(limit);
      return rows.map(mapTask);
    },

    async listStaged(now, limit) {
      const rows = await db
        .select()
        .from(nanoTasks)
        .where(
          and(
            product(),
            inArray(nanoTasks.status, [...STAGEABLE_STATUSES]),
            lte(nanoTasks.leaseUntil, now),
            isNotNull(nanoTasks.resultRef),
          ),
        )
        .orderBy(asc(nanoTasks.createdAt))
        .limit(limit);
      return rows.map(mapTask);
    },

    async listBySubject(subjectKey, input) {
      const { cursor, limit } = input;
      const rows = await db
        .select(TASK_SUMMARY)
        .from(nanoTasks)
        .where(
          and(
            eq(nanoTasks.subjectKey, subjectKey),
            product(),
            cursor
              ? or(
                  lt(nanoTasks.createdAt, cursor.createdAt),
                  and(eq(nanoTasks.createdAt, cursor.createdAt), lt(nanoTasks.id, cursor.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(nanoTasks.createdAt), desc(nanoTasks.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      return {
        tasks: page.map(mapTask),
        nextCursor:
          hasMore && last
            ? { createdAt: last.createdAt, id: last.id }
            : null,
      };
    },

    async markLeased(id, claim, leaseUntil) {
      const now = new Date();
      const [row] = await db
        .update(nanoTasks)
        .set({
          status: "leased",
          leaseOwner: claim.leaseOwner,
          leaseToken: claim.leaseToken,
          leaseUntil,
          updatedAt: now,
        })
        .where(
          and(
            eq(nanoTasks.id, id),
            product(),
            or(
              eq(nanoTasks.status, "queued"),
              and(
                eq(nanoTasks.status, "leased"),
                or(isNull(nanoTasks.leaseUntil), lte(nanoTasks.leaseUntil, now)),
              ),
            ),
          ),
        )
        .returning(TASK_WITHOUT_INPUT);
      return row ? mapTask(row) : null;
    },

    async markDispatching(id, providerRequestKey, claim) {
      const [row] = await db
        .update(nanoTasks)
        .set({ status: "dispatching", providerRequestKey, updatedAt: new Date() })
        .where(
          and(
            eq(nanoTasks.id, id),
            product(),
            eq(nanoTasks.status, "leased"),
            claimPredicate(claim),
          ),
        )
        .returning(TASK_WITHOUT_INPUT);
      return row ? mapTask(row) : null;
    },

    async markRunning(id, providerTaskId, claim) {
      const [row] = await db
        .update(nanoTasks)
        .set({ status: "running", providerTaskId, updatedAt: new Date() })
        .where(
          and(
            eq(nanoTasks.id, id),
            product(),
            eq(nanoTasks.status, "dispatching"),
            claimPredicate(claim),
          ),
        )
        .returning(TASK_WITHOUT_INPUT);
      return row ? mapTask(row) : null;
    },

    async recordCaseSelection(input) {
      if (input.productId !== productId) {
        throw new NanoInvalidInputError("Nano case selection productId does not match the bound product");
      }
      const [row] = await db
        .insert(nanoCaseSelections)
        .values({
          productId,
          caseId: input.caseId,
          requestKey: input.requestKey,
          userId: input.userId,
          selectedAt: input.selectedAt,
        })
        .onConflictDoNothing({
          target: [nanoCaseSelections.productId, nanoCaseSelections.userId, nanoCaseSelections.requestKey],
        })
        .returning({ id: nanoCaseSelections.id });
      return { recorded: !!row };
    },

    async caseStatsSince(since) {
      const rows = await db
        .select({
          caseId: nanoCaseSelections.caseId,
          count: sql<number>`count(*)::int`,
        })
        .from(nanoCaseSelections)
        .where(
          and(
            eq(nanoCaseSelections.productId, productId),
            gte(nanoCaseSelections.selectedAt, since),
          ),
        )
        .groupBy(nanoCaseSelections.caseId);
      const stats: Record<string, number> = {};
      for (const row of rows) stats[row.caseId] = row.count;
      return stats;
    },
  };
}

export interface NanoCoordinatorDeps<
  TSchema extends Record<string, unknown> = Record<string, unknown>,
> {
  db: PostgresJsDatabase<TSchema>;
  store: PgCommerceStore;
  commerce: Commerce;
  productId: string;
}

export interface NanoCoordinator {
  admit(input: NanoAdmitInput): Promise<NanoAdmitResult>;
  complete(
    taskId: string,
    result: { resultRef: string; resultSummary: string },
    claim?: NanoClaim | null,
  ): Promise<NanoTask>;
  fail(taskId: string, claim?: NanoClaim | null): Promise<NanoTask>;
  cancel(taskId: string): Promise<NanoTask>;
  /**
   * Status/result read for routes and polling. The uploaded input is not
   * loaded (`inputRef` is always null here); dispatch reads it through
   * `listDispatchable`.
   */
  get(taskId: string): Promise<NanoTask | null>;
  listDispatchable(now: Date, limit: number): Promise<NanoTask[]>;
  listStaged(now: Date, limit: number): Promise<NanoTask[]>;
  /** Summary rows: `inputRef` and `resultRef` are not loaded. */
  listStaleInFlight(now: Date, limit: number): Promise<NanoTask[]>;
  /** Ids of `unknown` tasks without a result that entered `unknown` at or before the cutoff. */
  listExpiredUnknown(enteredBefore: Date, limit: number): Promise<string[]>;
  /**
   * Unknown-expiry policy: settle an old `unknown` task as `failed` and refund
   * its spend in one transaction. Idempotent; `refunded` is true only for the
   * call that won the transition.
   */
  expireUnknown(taskId: string, enteredBefore: Date): Promise<NanoExpireUnknownResult>;
  /** Summary rows: `inputRef` and `resultRef` are not loaded. */
  listBySubject(
    subjectKey: string,
    input: { cursor: { createdAt: Date; id: string } | null; limit: number },
  ): Promise<{ tasks: NanoTask[]; nextCursor: { createdAt: Date; id: string } | null }>;
  markLeased(id: string, claim: NanoClaim, leaseUntil: Date): Promise<NanoTask | null>;
  markDispatching(id: string, providerRequestKey: string, claim: NanoClaim): Promise<NanoTask | null>;
  markRunning(id: string, providerTaskId: string, claim: NanoClaim): Promise<NanoTask | null>;
  stageResult(
    id: string,
    resultRef: string,
    resultSummary: string,
    claim: NanoClaim,
  ): Promise<NanoTask | null>;
  markUnknown(id: string, claim?: NanoClaim | null): Promise<NanoTask>;
  recordCaseSelection(input: {
    productId: string;
    caseId: string;
    requestKey: string;
    userId: string;
    selectedAt: Date;
  }): Promise<{ recorded: boolean }>;
  caseStatsSince(since: Date): Promise<Record<string, number>>;
}

export function createNanoCoordinator<TSchema extends Record<string, unknown>>(
  deps: NanoCoordinatorDeps<TSchema>,
): NanoCoordinator {
  const { db, store, commerce, productId } = deps;
  if (productId !== commerce.productId) {
    throw new Error(
      `Nano coordinator productId (${productId}) must match the bound Commerce productId (${commerce.productId})`,
    );
  }
  const repo = createNanoRepository(db as NanoDb, productId);

  return {
    admit(input) {
      return coordinatePgCommerce(store, commerce, ({ handle, unit }) =>
        admitTask(
          { tasks: createNanoRepository(handle, productId), commerce: commerce.join(unit) },
          input,
        ),
      );
    },
    complete(taskId, result, claim = null) {
      return coordinatePgCommerce(store, commerce, ({ handle, unit }) =>
        completeTask(
          { tasks: createNanoRepository(handle, productId), commerce: commerce.join(unit) },
          taskId,
          result,
          claim ?? null,
        ),
      );
    },
    fail(taskId, claim = null) {
      return coordinatePgCommerce(store, commerce, ({ handle, unit }) =>
        failTask(
          { tasks: createNanoRepository(handle, productId), commerce: commerce.join(unit) },
          taskId,
          claim ?? null,
        ),
      );
    },
    cancel(taskId) {
      return coordinatePgCommerce(store, commerce, ({ handle, unit }) =>
        cancelTask(
          { tasks: createNanoRepository(handle, productId), commerce: commerce.join(unit) },
          taskId,
        ),
      );
    },
    async get(taskId) {
      const [row] = await (db as NanoDb)
        .select(TASK_WITHOUT_INPUT)
        .from(nanoTasks)
        .where(and(eq(nanoTasks.id, taskId), eq(nanoTasks.productId, productId)))
        .limit(1);
      return row ? mapTask(row) : null;
    },
    listDispatchable: (now, limit) => repo.listDispatchable(now, limit),
    listStaged: (now, limit) => repo.listStaged(now, limit),
    listStaleInFlight: (now, limit) => repo.listStaleInFlight(now, limit),
    listExpiredUnknown: (enteredBefore, limit) => repo.listExpiredUnknown(enteredBefore, limit),
    expireUnknown(taskId, enteredBefore) {
      return coordinatePgCommerce(store, commerce, ({ handle, unit }) =>
        expireUnknownTask(
          { tasks: createNanoRepository(handle, productId), commerce: commerce.join(unit) },
          taskId,
          enteredBefore,
        ),
      );
    },
    listBySubject: (subjectKey, input) => repo.listBySubject(subjectKey, input),
    markLeased: (id, claim, leaseUntil) => repo.markLeased(id, claim, leaseUntil),
    markDispatching: (id, providerRequestKey, claim) =>
      repo.markDispatching(id, providerRequestKey, claim),
    markRunning: (id, providerTaskId, claim) => repo.markRunning(id, providerTaskId, claim),
    stageResult: (id, resultRef, resultSummary, claim) =>
      repo.stageResult(id, resultRef, resultSummary, claim),
    markUnknown(id, claim = null) {
      return coordinatePgCommerce(store, commerce, ({ handle, unit }) =>
        markUnknown(
          { tasks: createNanoRepository(handle, productId), commerce: commerce.join(unit) },
          id,
          claim ?? null,
        ),
      );
    },
    recordCaseSelection: (input) => repo.recordCaseSelection(input),
    caseStatsSince: (since) => repo.caseStatsSince(since),
  };
}
