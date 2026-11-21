/**
 * [INPUT]: Depends on @/actions/credits for getMyCredits/consumeCredits and the UserCredits type,
 *          ./actions for simulateFailedTask, @/components/ui/{button,card,skeleton},
 *          sonner for toast
 * [OUTPUT]: Exports the CreditUsageExamplePage client component (visible in development mode only)
 * [POS]: Developer example page of dashboard — three test cases demonstrating how to
 *        integrate the credit system: successful spend (returns txId) / simulated task
 *        failure with automatic refund (including idempotent replay) / insufficient
 *        balance handling; a teaching page of the template, not a business feature
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { consumeCredits, getMyCredits } from "@/actions/credits";
import type { UserCredits } from "@/lib/credits";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { simulateFailedTask } from "./actions";

const CREDITS_TO_SPEND = 10;
// Deliberately absurd — guaranteed to trip INSUFFICIENT_CREDITS.
const INSUFFICIENT_PROBE = 999_999;

interface LogLine {
  tone: "info" | "success" | "error";
  text: string;
}

const TONE_CLASS: Record<LogLine["tone"], string> = {
  info: "text-muted-foreground",
  success: "text-green-700 dark:text-green-400",
  error: "text-red-700 dark:text-red-400",
};

export default function CreditUsageExamplePage() {
  const [credits, setCredits] = useState<UserCredits | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);

  const appendLog = (lines: LogLine[]) => setLog((prev) => [...prev, ...lines]);

  const fetchCredits = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getMyCredits();
      if (!result.success) {
        throw new Error(result.error || "Failed to fetch credits.");
      }
      setCredits(result.data ?? null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load credits."
      );
      setCredits(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  // ──────────────────────────────────────────────
  //  Case 1 — successful task: deduct and keep the
  //  usage txId (a real feature stores it on its
  //  task row for a potential later refund)
  // ──────────────────────────────────────────────
  const handleSpend = async () => {
    setBusy("spend");
    appendLog([{ tone: "info", text: `▶ Spend ${CREDITS_TO_SPEND} credits (successful task)` }]);
    try {
      const result = await consumeCredits({
        amount: CREDITS_TO_SPEND,
        note: "Used feature from example page",
      });

      if (!result.success) {
        if (result.customCode === "INSUFFICIENT_CREDITS") {
          appendLog([{ tone: "error", text: `✗ INSUFFICIENT_CREDITS — buy a pack or subscribe first` }]);
          toast.error(
            `Not enough credits — this feature costs ${CREDITS_TO_SPEND} credits.`
          );
        } else {
          appendLog([{ tone: "error", text: `✗ ${result.error}` }]);
          toast.error(result.error || "Could not spend credits.");
        }
        await fetchCredits();
        return;
      }

      const data = result.data!;
      appendLog([
        { tone: "success", text: `✓ Spent ${CREDITS_TO_SPEND}. Balance: ${data.totalCredits} (sub ${data.subscriptionCredits} / purchased ${data.purchasedCredits})` },
        { tone: "info", text: `  usage txId = ${data.txId} — persist this on your task row` },
      ]);
      toast.success(`Spent ${CREDITS_TO_SPEND} credits.`);
      setCredits(data);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "An unexpected error occurred."
      );
      await fetchCredits();
    } finally {
      setBusy(null);
    }
  };

  // ──────────────────────────────────────────────
  //  Case 2 — failed task: the server deducts,
  //  fails, refunds to the original buckets and
  //  replays the refund to prove idempotency
  // ──────────────────────────────────────────────
  const handleSimulateFailure = async () => {
    setBusy("fail");
    appendLog([{ tone: "info", text: `▶ Simulate failed task (${CREDITS_TO_SPEND} credits, server-side refund)` }]);
    try {
      const result = await simulateFailedTask({ amount: CREDITS_TO_SPEND });

      if (!result.success) {
        if (result.customCode === "INSUFFICIENT_CREDITS") {
          appendLog([{ tone: "error", text: "✗ INSUFFICIENT_CREDITS — nothing to simulate with" }]);
          toast.error("Not enough credits to run the simulation.");
        } else {
          appendLog([{ tone: "error", text: `✗ ${result.error}` }]);
          toast.error(result.error || "Simulation failed.");
        }
        await fetchCredits();
        return;
      }

      const s = result.data!;
      appendLog([
        { tone: "info", text: `  1. spent ${CREDITS_TO_SPEND} → sub ${s.spentFromSubscription} + purchased ${s.spentFromPurchased} (subscription bucket drains first)` },
        { tone: "info", text: `     balance after spend: sub ${s.balanceAfterSpend.subscription} / purchased ${s.balanceAfterSpend.purchased}` },
        { tone: "info", text: `  2. task failed → refundSpentCredits(${s.txId.slice(0, 8)}…)` },
        { tone: "success", text: `  3. refunded to original buckets: sub ${s.balanceAfterRefund.subscription} / purchased ${s.balanceAfterRefund.purchased}` },
        s.replayWasNoop
          ? { tone: "success", text: "  4. replayed refund was a no-op ✓ (UNIQUE refundedTransactionId)" }
          : { tone: "error", text: "  4. replayed refund CHANGED the balance — this is a bug, report it" },
      ]);
      toast.success("Failed-task simulation completed — credits returned.");
      await fetchCredits();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "An unexpected error occurred."
      );
      await fetchCredits();
    } finally {
      setBusy(null);
    }
  };

  // ──────────────────────────────────────────────
  //  Case 3 — insufficient balance: the error path
  //  every feature must handle with an upsell
  // ──────────────────────────────────────────────
  const handleInsufficient = async () => {
    setBusy("insufficient");
    appendLog([{ tone: "info", text: `▶ Spend ${INSUFFICIENT_PROBE.toLocaleString()} credits (insufficient-balance probe)` }]);
    try {
      const result = await consumeCredits({
        amount: INSUFFICIENT_PROBE,
        note: "Insufficient credits probe from example page",
      });

      if (!result.success && result.customCode === "INSUFFICIENT_CREDITS") {
        appendLog([
          { tone: "success", text: "✓ got customCode INSUFFICIENT_CREDITS — balance untouched, no ledger row written" },
          { tone: "info", text: "  this is where a real feature surfaces the pricing-page upsell" },
        ]);
        toast.info("INSUFFICIENT_CREDITS returned, as expected.");
      } else if (!result.success) {
        appendLog([{ tone: "error", text: `✗ unexpected error: ${result.error}` }]);
        toast.error(result.error || "Unexpected error.");
      } else {
        appendLog([{ tone: "error", text: "✗ the spend SUCCEEDED — your balance is absurdly high" }]);
        await fetchCredits();
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "An unexpected error occurred."
      );
    } finally {
      setBusy(null);
    }
  };

  if (process.env.NODE_ENV === "production") {
    return (
      <div className="flex h-screen flex-col items-center justify-center">
        <h1 className="text-2xl font-bold">
          This page is only available in development mode.
        </h1>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Credit Usage Example</CardTitle>
          <CardDescription>
            Three test cases covering every path a feature must handle:
            successful spend, failed task with automatic refund, and
            insufficient balance. (Only for development)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : credits ? (
            <div className="space-y-1">
              <p>
                <strong>Total Credits:</strong> {credits.totalCredits}
              </p>
              <p>
                <strong>Subscription Credits:</strong>{" "}
                {credits.subscriptionCredits}
              </p>
              <p>
                <strong>Purchased Credits:</strong> {credits.purchasedCredits}
              </p>
            </div>
          ) : (
            <p className="text-destructive">
              Could not load your credit balance. Please try refreshing.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleSpend}
              disabled={busy !== null || isLoading || !credits}
            >
              {busy === "spend"
                ? "Spending..."
                : `1 · Successful Task (−${CREDITS_TO_SPEND})`}
            </Button>
            <Button
              variant="secondary"
              onClick={handleSimulateFailure}
              disabled={busy !== null || isLoading || !credits}
            >
              {busy === "fail"
                ? "Simulating..."
                : "2 · Failed Task → Auto Refund"}
            </Button>
            <Button
              variant="outline"
              onClick={handleInsufficient}
              disabled={busy !== null || isLoading || !credits}
            >
              {busy === "insufficient"
                ? "Probing..."
                : "3 · Insufficient Balance"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {log.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Run Log</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setLog([])}>
              Clear
            </Button>
          </CardHeader>
          <CardContent>
            <div className="max-h-80 overflow-auto rounded bg-muted p-3 font-mono text-xs leading-relaxed">
              {log.map((line, i) => (
                <div key={i} className={`whitespace-pre-wrap ${TONE_CLASS[line.tone]}`}>
                  {line.text}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>⚠️ Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <strong>How to charge credits for a feature:</strong>
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Call{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                consumeCredits(&#123; amount, note &#125;)
              </code>{" "}
              from{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                @/actions/credits
              </code>{" "}
              BEFORE running the expensive operation. It returns{" "}
              <code className="rounded bg-muted px-1 py-0.5">txId</code> — the
              usage ledger row. Persist it on your task row.
            </li>
            <li>
              <strong>When the task fails</strong>, server-side code calls{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                refundSpentCredits(&#123; userId, spendTxId &#125;)
              </code>{" "}
              from <code className="rounded bg-muted px-1 py-0.5">@/lib/credits</code>.
              It returns the exact split to the buckets it came from and is
              idempotent — safe to call from retried webhooks. NEVER expose it
              through a client-callable action: a user who can refund at will
              gets every task for free (see{" "}
              <code className="rounded bg-muted px-1 py-0.5">./actions.ts</code>{" "}
              for the safe server-side pattern).
            </li>
            <li>
              Subscription credits are spent first, then purchased credits.
              Purchased credits never expire; subscription credits reset each
              billing cycle.
            </li>
            <li>
              When the balance is too low, the action fails with{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                customCode: &quot;INSUFFICIENT_CREDITS&quot;
              </code>{" "}
              — surface an upsell to the pricing page. Nothing is written to
              the ledger.
            </li>
            <li>
              Every movement is recorded in the credit ledger and visible to
              the user on the Billing page — including{" "}
              <code className="rounded bg-muted px-1 py-0.5">usage_refund</code>{" "}
              rows from failed tasks.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
