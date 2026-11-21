/**
 * Nano crash-point worker. Spawned by `test/domain/nano-restart.test.ts`.
 *
 * It opens its own database/coordinator instances (a fresh process by
 * construction) and executes the requested crash phase through the real Nano
 * coordinator, commerce ledger, and the real Google GenAI SDK with an in-memory
 * transport (`GoogleMemoryTransportProvider`) so the remote-accepted count
 * reflects actual SDK HTTP invocations. Every crash point uses a real `SIGKILL`
 * (not `process.exit(0)` and not a thrown error), so a commit that has not
 * happened yet rolls back and a commit that has happened is durable for the
 * parent's recovery sweep.
 */
import { db } from "@/lib/db";
import { createNanoCoordinator, createNanoRepository } from "@sunpcm/niu-persistence-pg/nano";
import { coordinatePgCommerce } from "@sunpcm/niu-persistence-pg/commerce";
import { createAppCommerce } from "@/composition/commerce";
import { admitTask, cancelTask } from "@sunpcm/niu-feature-nano";
import { serializeProviderResult } from "@/lib/nano/dto";
import { createNanoClaim } from "@/lib/nano/dispatch";
import { GoogleMemoryTransportProvider } from "./google-memory-transport";

const PRODUCT = "nexty_overnight_nano";
const phase = process.env.NANO_PHASE ?? "";
const userId = process.env.NANO_USER_ID ?? "";
const requestKey = process.env.NANO_REQUEST_KEY ?? "crash-rk";
const counterFile = process.env.NANO_COUNTER_FILE;

const app = createAppCommerce({ schedulePostCommit: () => {}, productId: PRODUCT });
const coordinator = createNanoCoordinator({
  db,
  store: app.store,
  commerce: app.commerce,
  productId: PRODUCT,
});
const provider = new GoogleMemoryTransportProvider({ counterFile });

function admitInput(contentSummary = "crash-sum") {
  return {
    productId: PRODUCT,
    subject: { userId, organizationId: null } as const,
    actorUserId: userId,
    feature: "nano-image",
    requestKey,
    contentSummary,
    cost: 1,
    inputRef: {
      prompt: "crash",
      imageData:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      mimeType: "image/png",
    },
  };
}

async function dispatchAndKill(killAfterStage: boolean): Promise<void> {
  const result = await coordinator.admit(admitInput());
  const claim = createNanoClaim("crash-worker");
  const leaseUntil = new Date(Date.now() + 120_000);
  const leased = await coordinator.markLeased(result.task.id, claim, leaseUntil);
  if (!leased) throw new Error("failed to lease task");
  const dispatching = await coordinator.markDispatching(result.task.id, requestKey, claim);
  if (!dispatching) throw new Error("failed to mark dispatching");

  const generated = await provider.generate({
    prompt: "crash",
    imageData: null,
    mimeType: null,
    model: "gemini",
  });
  if (killAfterStage) {
    const { resultRef, resultSummary } = serializeProviderResult(generated);
    const staged = await coordinator.stageResult(result.task.id, resultRef, resultSummary, claim);
    if (!staged) throw new Error("failed to stage result");
  }
  console.log(`TASK ${result.task.id}`);
  process.kill(process.pid, "SIGKILL");
}

async function main(): Promise<void> {
  if (phase === "before-write") {
    // Kill before any database write.
    process.kill(process.pid, "SIGKILL");
    return;
  }

  if (phase === "after-spend-before-commit") {
    await coordinatePgCommerce(app.store, app.commerce, async ({ handle, unit }) => {
      await admitTask(
        {
          tasks: createNanoRepository(handle, PRODUCT),
          commerce: app.commerce.join(unit),
        },
        admitInput("spend-crash-sum"),
      );
      // Kill after the full production admit (task + spend + spendTxId + active
      // job) but before the owned transaction commits, so all four roll back.
      process.kill(process.pid, "SIGKILL");
    });
    return;
  }

  if (phase === "after-commit-before-dispatch") {
    const result = await coordinator.admit(admitInput());
    console.log(`TASK ${result.task.id}`);
    process.kill(process.pid, "SIGKILL");
    return;
  }

  if (phase === "after-remote-before-association") {
    await dispatchAndKill(false);
    return;
  }

  if (phase === "after-stage-before-terminal") {
    await dispatchAndKill(true);
    return;
  }

  if (phase === "before-terminal-commit") {
    const result = await coordinator.admit(admitInput("terminal-crash-sum"));
    // Run the real cancel transition + refund inside one owned transaction,
    // then SIGKILL before the transaction commits, so both roll back together.
    await coordinatePgCommerce(app.store, app.commerce, async ({ handle, unit }) => {
      await cancelTask(
        { tasks: createNanoRepository(handle, PRODUCT), commerce: app.commerce.join(unit) },
        result.task.id,
      );
      process.kill(process.pid, "SIGKILL");
    });
    return;
  }

  throw new Error(`Unknown phase: ${phase}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
