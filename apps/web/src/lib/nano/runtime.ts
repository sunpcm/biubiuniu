import { randomUUID } from "node:crypto";
import type { NanoProvider } from "@sunpcm/niu-feature-nano";
import type { NanoCoordinator } from "@sunpcm/niu-persistence-pg/nano";
import { getLogger, type AppLogger } from "@/lib/logger";
import {
  sweepDispatchable,
  sweepExpiredUnknown,
  sweepStaged,
  sweepStaleInFlight,
  type NanoDispatchConfig,
} from "./dispatch";

/**
 * In-process Nano dispatch controller.
 *
 * This is an explicit lifecycle object. Importing this module never starts a
 * timer or opens a database connection; a caller must call `start()`. The
 * instance owns a random `owner` id and runs bounded sweeps in this order:
 * dispatchable (paid re-submit) -> staged (finalize a persisted result) ->
 * stale in-flight (mark unknown) -> expired unknown (fail + refund). Overlapping
 * sweeps are guarded by an in-memory flag; `stop()` clears the timer, never
 * leaves a background interval, and closes the lease gate so a sweep that is
 * still running finishes its in-flight provider calls but leases nothing new.
 * Each step is isolated: a failure in one does not skip the recovery steps
 * after it.
 *
 * New admission is the only provider-gated step: when `provider` is null (Nano
 * disabled or no API key) the controller still runs `sweepStaged` and
 * `sweepStaleInFlight`, and `sweepExpiredUnknown`, which finalize persisted
 * results, converge lost in-flight rows, and refund expired unknown tasks
 * without needing a provider or re-submitting paid work.
 *
 * Single-instance scope only. A cross-process global cap would require a PG
 * coordination lease and is intentionally not claimed here.
 */
export interface NanoRuntimeControllerOptions {
  coordinator: NanoCoordinator;
  provider: NanoProvider | null;
  model: string;
  leaseMs: number;
  batchSize: number;
  maxConcurrent: number;
  pollIntervalMs?: number;
  /** Unknown-expiry threshold; omit to leave `unknown` tasks untouched. */
  unknownRefundAfterMs?: number;
  logger?: Pick<AppLogger, "warn">;
}

export interface NanoRuntimeController {
  start(): void;
  stop(): void;
  runOnce(): Promise<void>;
  restart(): void;
  isRunning(): boolean;
}

const DEFAULT_POLL_INTERVAL_MS = 5_000;

export function createNanoRuntimeController(
  options: NanoRuntimeControllerOptions,
): NanoRuntimeController {
  const owner = randomUUID();
  const logger = options.logger ?? getLogger("nano.runtime");
  let timer: ReturnType<typeof setInterval> | null = null;
  let sweeping = false;
  let stopping = false;

  // Stable codes and ids only: never a prompt, image, or raw provider error.
  const onUnknown: NonNullable<NanoDispatchConfig["onUnknown"]> = (event) => {
    logger.warn(
      { code: "nano_task_unknown", owner, taskId: event.taskId, reason: event.reason },
      "Nano task outcome is unknown",
    );
  };
  const config: NanoDispatchConfig = {
    owner,
    leaseMs: options.leaseMs,
    model: options.model,
    batchSize: options.batchSize,
    maxConcurrent: options.maxConcurrent,
    shouldStop: () => stopping,
    onUnknown,
  };

  async function step(name: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch {
      // Never surface a raw provider/database error here. A stable code only.
      logger.warn({ code: "nano_sweep_failed", owner, step: name }, "Nano sweep failed");
    }
  }

  async function runOnce(): Promise<void> {
    if (sweeping) return;
    sweeping = true;
    try {
      const provider = options.provider;
      if (provider) {
        await step("dispatch", () => sweepDispatchable(options.coordinator, provider, config));
      }
      await step("staged", () => sweepStaged(options.coordinator));
      await step("stale", () =>
        sweepStaleInFlight(options.coordinator, new Date(), 100, onUnknown),
      );
      const refundAfterMs = options.unknownRefundAfterMs;
      if (refundAfterMs !== undefined) {
        await step("unknown-expiry", () =>
          sweepExpiredUnknown(options.coordinator, refundAfterMs, new Date(), 100, (event) => {
            logger.warn(
              { code: "nano_unknown_refunded", owner, taskId: event.taskId, cost: event.cost },
              "Nano unknown task expired and was refunded",
            );
          }),
        );
      }
    } finally {
      sweeping = false;
    }
  }

  function start(): void {
    if (timer) return;
    stopping = false;
    void runOnce();
    timer = setInterval(() => {
      void runOnce();
    }, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop(): void {
    stopping = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    start,
    stop,
    runOnce,
    restart() {
      stop();
      start();
    },
    isRunning: () => timer !== null,
  };
}
