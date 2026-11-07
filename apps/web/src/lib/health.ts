export type CheckStatus = "ok" | "down" | "skipped";

export interface CheckResult {
  status: CheckStatus;
  latencyMs: number;
}

export interface HealthCheck {
  name: string;
  probe: (() => Promise<unknown>) | null;
}

export interface HealthEvaluation {
  checks: Record<string, CheckResult>;
  healthy: boolean;
}

interface EvaluateHealthOptions {
  timeoutMs: number;
  now?: () => number;
  onFailure?: (check: HealthCheck, error: unknown) => void;
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`health check timed out after ${ms}ms`)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function runCheck(check: HealthCheck, options: EvaluateHealthOptions): Promise<CheckResult> {
  if (!check.probe) {
    return { status: "skipped", latencyMs: 0 };
  }

  const now = options.now ?? Date.now;
  const startedAt = now();
  try {
    await withTimeout(check.probe(), options.timeoutMs);
    return { status: "ok", latencyMs: Math.max(0, now() - startedAt) };
  } catch (error) {
    options.onFailure?.(check, error);
    return { status: "down", latencyMs: Math.max(0, now() - startedAt) };
  }
}

export async function evaluateHealthChecks(
  checks: HealthCheck[],
  options: EvaluateHealthOptions,
): Promise<HealthEvaluation> {
  const results = await Promise.all(checks.map((check) => runCheck(check, options)));
  const entries = checks.map((check, index) => [check.name, results[index]] as const);

  return {
    checks: Object.fromEntries(entries),
    healthy: results.every((result) => result.status !== "down"),
  };
}
