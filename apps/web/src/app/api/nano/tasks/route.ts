import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getNanoRuntime } from "@/composition/nano";
import { admitNanoTask } from "@/lib/nano/admit";
import {
  decodeCursor,
  encodeCursor,
  toPublicTaskListItem,
} from "@/lib/nano/dto";
import { nanoAuthRequiredResponse, nanoErrorResponse } from "@/lib/nano/errors";
import { resolveNanoPrincipal } from "@/lib/nano/identity";
import { nanoSubjectKey } from "@sunpcm/niu-feature-nano";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

function parsePageSize(value: string | null): number {
  if (value === null) return DEFAULT_PAGE_SIZE;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, parsed));
}

export async function POST(request: NextRequest) {
  return admitNanoTask(request, { requireRequestKey: true });
}

export async function GET(request: NextRequest) {
  const runtime = await getNanoRuntime();
  const principal = await resolveNanoPrincipal();
  if (!principal) return nanoAuthRequiredResponse();

  try {
    const { searchParams } = new URL(request.url);
    const pageSize = parsePageSize(searchParams.get("pageSize"));
    const cursorRaw = searchParams.get("nextCursor");
    const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
    if (cursorRaw && !cursor) {
      return NextResponse.json(
        { success: false, error: "Invalid nextCursor", code: "INVALID_INPUT" },
        { status: 400 },
      );
    }

    const page = await runtime.coordinator.listBySubject(
      nanoSubjectKey(principal.subject),
      { cursor, limit: pageSize },
    );

    return NextResponse.json({
      success: true,
      data: {
        tasks: page.tasks.map(toPublicTaskListItem),
        nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
      },
    });
  } catch (error) {
    return nanoErrorResponse(error);
  }
}
