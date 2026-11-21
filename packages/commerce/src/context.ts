import { sanitizeLogData, sanitizeLogText } from "./privacy.js";
import type { CommerceClock, CommerceLogger, CommerceNotifier, TrustedIdentity } from "./types.js";
import type { CommerceCatalog } from "./types.js";
import type { PaymentProvider } from "./types.js";
import type { CommerceStore, CommerceUnit } from "./store.js";

export interface CommerceDeps {
  productId: string;
  catalog: CommerceCatalog;
  clock: CommerceClock;
  identity: TrustedIdentity;
  store: CommerceStore;
  logger: CommerceLogger;
  schedulePostCommit: (task: () => void | Promise<void>) => void;
  notifier?: CommerceNotifier;
  purchasesEnabled?: boolean;
  dedupe?: { claim(key: string, ttlSeconds: number): Promise<boolean> };
  mailer?: {
    send(message: { to: string; from: { email: string; name?: string }; subject: string; template: string; props: Record<string, unknown> }): Promise<void>;
  };
  admin?: { email?: string | null; name?: string | null; siteName?: string | null; siteUrl?: string | null; supportUrl?: string | null; billingUrl?: string | null };
  cancelSubscription?: (provider: PaymentProvider, providerSubscriptionId: string, reason: string) => Promise<boolean>;
}

export interface CommerceRuntime {
  deps: CommerceDeps;
  catalog: CommerceCatalog;
  withUnit<T>(outer: CommerceUnit | undefined, run: (unit: CommerceUnit) => Promise<T>): Promise<T>;
  afterCommit(unit: CommerceUnit, task: () => void | Promise<void>): void;
  /**
   * Schedule post-commit work that was queued on an outer unit. Call this only
   * after that unit's transaction has committed. The PG coordinator does it.
   */
  flushOuter(unit: CommerceUnit): void;
  /** Drop post-commit work after the outer transaction rolls back. */
  discardOuter(unit: CommerceUnit): void;
  log(level: "warn" | "error", data: object, message: string): void;
}

export function createRuntime(deps: CommerceDeps, catalog: CommerceCatalog): CommerceRuntime {
  const gates = new WeakMap<CommerceUnit, Array<() => void | Promise<void>>>();
  function queueFor(unit: CommerceUnit): Array<() => void | Promise<void>> {
    let tasks = gates.get(unit);
    if (!tasks) {
      tasks = [];
      gates.set(unit, tasks);
    }
    return tasks;
  }
  const runtime: CommerceRuntime = {
    deps,
    catalog,
    async withUnit(outer, run) {
      if (outer) {
        return deps.store.transaction(async (unit) => {
          if (unit !== outer) throw new Error("Commerce transaction does not belong to this instance");
          queueFor(unit);
          return run(unit);
        }, outer);
      }
      const tasks: Array<() => void | Promise<void>> = [];
      const result = await deps.store.transaction(async (unit) => {
        gates.set(unit, tasks);
        try {
          return await run(unit);
        } finally {
          gates.delete(unit);
        }
      });
      for (const task of tasks) deps.schedulePostCommit(task);
      return result;
    },
    afterCommit(unit, task) {
      const tasks = gates.get(unit);
      if (!tasks) throw new Error("post-commit task scheduled outside the outermost commerce transaction");
      tasks.push(task);
    },
    flushOuter(unit) {
      const tasks = gates.get(unit);
      if (!tasks) return;
      gates.delete(unit);
      for (const task of tasks) deps.schedulePostCommit(task);
    },
    discardOuter(unit) {
      gates.delete(unit);
    },
    log(level, data, message) {
      deps.logger[level](sanitizeLogData(data), sanitizeLogText(message));
    },
  };
  return runtime;
}
