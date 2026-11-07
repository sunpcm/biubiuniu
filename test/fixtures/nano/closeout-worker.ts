/**
 * Fresh-process Nano closeout worker spawned by nano-closeout-process.test.ts.
 *
 * The only substituted boundary is the Google GenAI SDK's documented global
 * fetch transport. Composition, bootstrap, the real PG coordinator, Commerce
 * ledger, dispatch sweeps and the real SDK all run in this new process. The
 * parent passes a unique scratch path and one synthetic command over stdin;
 * no in-process Map or shared timer can stand in for a restart.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import type { AppNanoRuntime } from "@/composition/nano";
import { closeDatabase } from "@/lib/db";
import { databaseUrl } from "../../domain/helpers";
import type { NanoTaskStatus } from "@sunpcm/niu-feature-nano";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const WATCH_TIMEOUT_MS = 10_000;
const RECEIPT_PREFIX = "NANO_CLOSEOUT_RECEIPT\t";

type CloseoutMode = "success" | "timeout";

interface WatchTarget {
  taskId: string;
  status: NanoTaskStatus;
}

interface CloseoutCommand {
  launch: string;
  mode: CloseoutMode;
  counterFile: string;
  eventsFile: string;
  watch: WatchTarget[];
}

interface CloseoutReceipt {
  launch: string;
  productId: string;
  enabled: boolean;
  publicEnabled: boolean;
  provider: boolean;
  statuses: Record<string, NanoTaskStatus>;
  sdkCalls: number;
  abortSignals: number;
}

function countSdkCall(command: CloseoutCommand): number {
  const current = Number.parseInt(readFileSync(command.counterFile, "utf8").trim() || "0", 10);
  const next = Number.isFinite(current) ? current + 1 : 1;
  writeFileSync(command.counterFile, String(next));
  appendFileSync(command.eventsFile, `${JSON.stringify({ event: "sdk-call", count: next })}\n`);
  return next;
}

function record(command: CloseoutCommand, payload: Record<string, unknown>): void {
  appendFileSync(command.eventsFile, `${JSON.stringify(payload)}\n`);
}

function eventCount(command: CloseoutCommand, event: string): number {
  const lines = readFileSync(command.eventsFile, "utf8").split("\n").filter(Boolean);
  return lines.reduce((count, line) => {
    const payload = JSON.parse(line) as { event?: unknown };
    return payload.event === event ? count + 1 : count;
  }, 0);
}

function successResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ inlineData: { mimeType: "image/png", data: PNG_BASE64 } }],
                },
              },
            ],
          })}\n\n`,
        ),
      );
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/**
 * Install the SDK's sole allowed transport fixture before the app composition
 * constructs its real GoogleGenAI client. A timeout fetch waits for the SDK's
 * own `httpOptions.timeout` abort signal; it never invents a timeout class.
 */
function installSdkTransport(command: CloseoutCommand): void {
  const fetchOverride = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    void input;
    const count = countSdkCall(command);
    record(command, { event: "sdk-call-observed", count });
    if (command.mode !== "timeout") return successResponse();
    const signal = init?.signal;
    if (!signal) throw new Error("Google SDK omitted its per-request abort signal");
    return await new Promise<Response>((_resolve, reject) => {
      const abort = () => {
        record(command, { event: "sdk-abort-signal" });
        reject(signal.reason ?? new Error("SDK request aborted"));
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
    });
  };
  globalThis.fetch = fetchOverride as typeof globalThis.fetch;
}

async function waitForSweep(
  command: CloseoutCommand,
  runtime: AppNanoRuntime,
): Promise<Record<string, NanoTaskStatus>> {
  const deadline = Date.now() + WATCH_TIMEOUT_MS;
  let statuses: Record<string, NanoTaskStatus> = {};
  while (Date.now() < deadline) {
    const tasks = await Promise.all(
      command.watch.map((target) => runtime.coordinator.get(target.taskId)),
    );
    statuses = {};
    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index];
      const target = command.watch[index];
      if (task) statuses[target.taskId] = task.status;
    }
    if (command.watch.every((target) => statuses[target.taskId] === target.status)) {
      return statuses;
    }
    await sleep(25);
  }
  throw new Error(`bootstrap sweep did not converge: ${JSON.stringify(statuses)}`);
}

async function main(command: CloseoutCommand): Promise<CloseoutReceipt> {
  void databaseUrl();
  installSdkTransport(command);

  const { getNanoRuntime } = await import("@/composition/nano");
  const { startNanoRuntimeOnce } = await import("@/lib/nano/bootstrap");
  const runtime = await getNanoRuntime();

  const receipt: CloseoutReceipt = {
    launch: command.launch,
    productId: runtime.productId,
    enabled: runtime.enabled,
    publicEnabled: runtime.publicConfig.enabled,
    provider: runtime.provider !== null,
    statuses: {},
    sdkCalls: 0,
    abortSignals: 0,
  };

  await startNanoRuntimeOnce();
  receipt.statuses = await waitForSweep(command, runtime);
  receipt.sdkCalls = Number.parseInt(readFileSync(command.counterFile, "utf8").trim() || "0", 10);
  receipt.abortSignals = eventCount(command, "sdk-abort-signal");
  return receipt;
}

let command: CloseoutCommand | undefined;
const chunks: Buffer[] = [];

const timeoutHandle = setTimeout(() => {
  const detail = command ? ` mode=${command.mode}` : "";
  process.stderr.write(`closeout worker timed out${detail}\n`);
  process.kill(process.pid, "SIGKILL");
}, 15_000);
timeoutHandle.unref?.();

process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
process.stdin.on("end", () => {
  void (async () => {
    let receipt: CloseoutReceipt | undefined;
    let failure: unknown;
    try {
      command = JSON.parse(Buffer.concat(chunks).toString("utf8")) as CloseoutCommand;
      receipt = await main(command);
    } catch (error) {
      failure = error;
    }
    clearTimeout(timeoutHandle);
    try {
      await closeDatabase();
    } catch (error) {
      failure ??= error;
    }
    if (failure) {
      process.stderr.write(`${failure instanceof Error ? failure.stack : String(failure)}\n`);
      process.exitCode = 1;
      return;
    }
    if (!receipt) {
      process.stderr.write("closeout worker completed without a receipt\n");
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`${RECEIPT_PREFIX}${JSON.stringify(receipt)}\n`);
  })();
});
