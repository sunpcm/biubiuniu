import { NextResponse, type NextRequest } from "next/server";
import { NanoInvalidInputError } from "@sunpcm/niu-feature-nano";
import { getNanoRuntime } from "@/composition/nano";
import { nanoAuthRequiredResponse, nanoDisabledResponse, nanoErrorResponse } from "./errors";
import { resolveNanoPrincipal } from "./identity";
import { nanoContentSummary } from "./summary";
import { validateAdmitBody } from "./validate";

const ADMIT_FEATURE = "nano-image";

/**
 * Shared admit flow for `/api/nano/tasks` and the legacy
 * `/api/nano/gemini-image` compatibility route. The legacy route derives a
 * deterministic requestKey from the content when none is supplied.
 */
export async function admitNanoTask(
  request: NextRequest,
  options: { requireRequestKey?: boolean } = {},
): Promise<NextResponse> {
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
    const input = validateAdmitBody(body, runtime.config, runtime.caseCatalog, {
      requireRequestKey: options.requireRequestKey,
    });

    const requestKey =
      input.requestKey ??
      nanoContentSummary({
        prompt: input.prompt,
        image: input.image,
        mimeType: input.mimeType,
        caseId: input.caseId,
      });
    const contentSummary = nanoContentSummary({
      prompt: input.prompt,
      image: input.image,
      mimeType: input.mimeType,
      caseId: input.caseId,
    });

    const result = await runtime.coordinator.admit({
      productId: runtime.productId,
      subject: principal.subject,
      actorUserId: principal.actorUserId,
      feature: ADMIT_FEATURE,
      requestKey,
      contentSummary,
      cost: runtime.config.cost,
      inputRef: {
        prompt: input.prompt,
        imageData: input.image,
        mimeType: input.mimeType,
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          taskId: result.task.id,
          status: result.task.status,
          created: result.created,
          cost: result.task.cost,
        },
      },
      { status: result.created ? 202 : 200 },
    );
  } catch (error) {
    return nanoErrorResponse(error);
  }
}
