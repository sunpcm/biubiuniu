import { randomUUID } from "node:crypto";
import type { NanoProvider } from "@sunpcm/niu-feature-nano";
import type { NanoCoordinator } from "@sunpcm/niu-persistence-pg/nano";
import { getLogger, type AppLogger } from "@/lib/logger";
import {
  sweepDispatchable,
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
 * stale in-flight (mark unknown). Overlapping sweeps are guarded by an in-memory
 * flag; `stop()` clears the timer and never leaves a background interval.
 *
 * New admission is the only provider-gated step: when `provider` is null (Nano
 * disabled or no API key) the controller still runs `sweepStaged` and
 * `sweepStaleInFlight`, which finalize persisted results and converge lost
 * in-flight rows without needing a provider or re-submitting paid work.
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
  const config: NanoDispatchConfig = {
    owner,
    leaseMs: options.leaseMs,
    model: options.model,
    batchSize: options.batchSize,
    maxConcurrent: options.maxConcurrent,
  };
  const logger = options.logger ?? getLogger("nano.runtime");
  let timer: ReturnType<typeof setInterval> | null = null;
  let sweeping = false;

  async function runOnce(): Promise<void> {
    if (sweeping) return;
    sweeping = true;
    try {
      if (options.provider) {
        await sweepDispatchable(options.coordinator, options.provider, config);
      }
      await sweepStaged(options.coordinator);
      await sweepStaleInFlight(options.coordinator);
    } catch {
      // Never surface a raw provider/database error here. A stable code only.
      logger.warn({ code: "nano_sweep_failed", owner }, "Nano sweep failed");
    } finally {
      sweeping = false;
    }
  }

  function start(): void {
    if (timer) return;
    void runOnce();
    timer = setInterval(() => {
      void runOnce();
    }, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop(): void {
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
