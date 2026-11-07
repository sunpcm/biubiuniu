import { NextResponse } from "next/server";
import { getNanoRuntime } from "@/composition/nano";
import { parseResultRef } from "@/lib/nano/dto";
import { nanoAuthRequiredResponse } from "@/lib/nano/errors";
import { resolveNanoPrincipal } from "@/lib/nano/identity";
import { nanoSubjectKey } from "@sunpcm/niu-feature-nano";

type Params = Promise<{ taskId: string; index: string }>;

/**
 * Authorized same-origin read of one generated result image. This is the URL a
 * client uses for object-backed results and also serves inline results with the
 * correct MIME type. The caller's session + subject ownership are re-checked
 * here; a raw objectKey is never a public capability.
 */
export async function GET(_request: Request, { params }: { params: Params }) {
  const { taskId, index } = await params;
  const runtime = await getNanoRuntime();
  const principal = await resolveNanoPrincipal();
  if (!principal) return nanoAuthRequiredResponse();

  const task = await runtime.coordinator.get(taskId);
  if (
    !task ||
    task.productId !== runtime.productId ||
    task.subjectKey !== nanoSubjectKey(principal.subject) ||
    task.status !== "succeeded" ||
    !task.resultRef
  ) {
    return new NextResponse("Not found", { status: 404 });
  }

  const result = parseResultRef(task.resultRef);
  const parsedIndex = Number.parseInt(index, 10);
  const image = result?.images[parsedIndex];
  if (!image) {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(Buffer.from(image.dataBase64, "base64"), {
    headers: {
      "Content-Type": image.mimeType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
