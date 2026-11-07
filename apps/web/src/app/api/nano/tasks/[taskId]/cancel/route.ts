import { NextResponse } from "next/server";
import { getNanoRuntime } from "@/composition/nano";
import { nanoAuthRequiredResponse, nanoErrorResponse } from "@/lib/nano/errors";
import { resolveNanoPrincipal } from "@/lib/nano/identity";
import { nanoSubjectKey } from "@sunpcm/niu-feature-nano";

type Params = Promise<{ taskId: string }>;

export async function POST(_request: Request, { params }: { params: Params }) {
  const { taskId } = await params;
  const runtime = await getNanoRuntime();
  const principal = await resolveNanoPrincipal();
  if (!principal) return nanoAuthRequiredResponse();

  try {
    const task = await runtime.coordinator.get(taskId);
    if (
      !task ||
      task.productId !== runtime.productId ||
      task.subjectKey !== nanoSubjectKey(principal.subject)
    ) {
      return NextResponse.json(
        { success: false, error: "Task not found", code: "NOT_FOUND" },
        { status: 404 },
      );
    }

    const updated = await runtime.coordinator.cancel(taskId);
    return NextResponse.json({
      success: true,
      data: {
        taskId: updated.id,
        status: updated.status,
        refunded: updated.status === "canceled",
      },
    });
  } catch (error) {
    return nanoErrorResponse(error);
  }
}
