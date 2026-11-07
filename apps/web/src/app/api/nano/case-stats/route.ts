import { NextResponse, type NextRequest } from "next/server";
import { NanoInvalidInputError } from "@sunpcm/niu-feature-nano";
import { getNanoRuntime } from "@/composition/nano";
import {
  nanoAuthRequiredResponse,
  nanoDisabledResponse,
  nanoErrorResponse,
} from "@/lib/nano/errors";
import { resolveNanoPrincipal } from "@/lib/nano/identity";
import { validateCaseSelectionBody } from "@/lib/nano/validate";

const CASE_STATS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const TOP_CASES_LIMIT = 3;

export async function POST(request: NextRequest) {
  const runtime = await getNanoRuntime();
  if (!runtime.enabled) return nanoDisabledResponse();

  const principal = await resolveNanoPrincipal();
  if (!principal) return nanoAuthRequiredResponse();

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return nanoErrorResponse(new NanoInvalidInputError("Invalid JSON body"));
    }
    const input = validateCaseSelectionBody(body, runtime.caseCatalog);
    const result = await runtime.coordinator.recordCaseSelection({
      productId: runtime.productId,
      caseId: input.caseId,
      requestKey: input.requestKey,
      userId: principal.userId,
      selectedAt: new Date(),
    });
    return NextResponse.json({ success: true, data: { recorded: result.recorded } });
  } catch (error) {
    return nanoErrorResponse(error);
  }
}

export async function GET() {
  const runtime = await getNanoRuntime();
  try {
    const since = new Date(Date.now() - CASE_STATS_WINDOW_MS);
    const stats = await runtime.coordinator.caseStatsSince(since);
    const topCases = Object.entries(stats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, TOP_CASES_LIMIT)
      .map(([caseId]) => caseId);
    return NextResponse.json({ success: true, data: { topCases, stats } });
  } catch (error) {
    return nanoErrorResponse(error);
  }
}
