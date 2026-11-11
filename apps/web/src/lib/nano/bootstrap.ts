/**
 * In-process Nano bootstrap for the real Next Node server.
 *
 * Next.js only writes `NEXT_PHASE` into `process.env` for `next build`
 * (`phase-production-build`). `next start` and `next dev` pass their phase to
 * `loadConfig` as a function argument and leave `NEXT_PHASE` unset, while still
 * invoking `instrumentation.register()`. Requiring `phase-production-server` or
 * `phase-development-server` therefore never matches a real server bootstrap
 * and silently disables recovery. This module instead treats an unset phase as
 * a real server and only skips build/static export.
 *
 * Importing this module is side-effect free; no timer is created and no
 * database connection is opened until `startNanoRuntimeOnce()` is called.
 */

/**
 * Phases where Next is not serving a live Node server. Build and static export
 * must never start a timer or run a business sweep. `phase-export` is included
 * defensively for static export tooling even though Next 16 normally runs it
 * under `phase-production-build`.
 */
const NON_BOOTSTRAP_PHASES = new Set(["phase-production-build", "phase-export"]);

/**
 * True for a real Node server bootstrap. An unset `NEXT_PHASE` is the normal
 * production/dev server shape and must start recovery; only build/static
 * export are excluded. The `nodejs` vs `edge` runtime split is handled by the
 * caller in `instrumentation.register()`.
 */
export function isNanoBootstrapPhase(phase: string | undefined): boolean {
  if (phase === undefined) return true;
  return !NON_BOOTSTRAP_PHASES.has(phase);
}

let bootstrapPromise: Promise<void> | undefined;

/**
 * Assemble and start the in-process Nano dispatch controller exactly once per
 * process. Idempotent under repeated or concurrent `register()` calls: the
 * first caller owns assembly and later callers await the same promise, so no
 * duplicate timer or SIGTERM/SIGINT listener is ever created.
 *
 * The controller always runs staged/stale recovery sweeps even when Nano is
 * disabled or the provider key is missing, so tasks accepted before a shutdown
 * still converge after a real restart.
 */
export function startNanoRuntimeOnce(): Promise<void> {
  if (!isNanoBootstrapPhase(process.env.NEXT_PHASE)) {
    return Promise.resolve();
  }
  bootstrapPromise ??= bootstrap();
  return bootstrapPromise;
}

async function bootstrap(): Promise<void> {
  const { getNanoRuntime } = await import("@/composition/nano");
  const runtime = await getNanoRuntime();

  const { createNanoRuntimeController } = await import("@/lib/nano/runtime");
  const controller = createNanoRuntimeController({
    coordinator: runtime.coordinator,
    provider: runtime.provider,
    model: runtime.config.model,
    leaseMs: runtime.config.leaseMs,
    batchSize: runtime.config.dispatchBatchSize,
    maxConcurrent: runtime.config.maxConcurrentDispatches,
    pollIntervalMs: runtime.config.pollIntervalMs,
    unknownRefundAfterMs: runtime.config.unknownRefundAfterMs,
  });
  controller.start();

  const stop = () => controller.stop();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
