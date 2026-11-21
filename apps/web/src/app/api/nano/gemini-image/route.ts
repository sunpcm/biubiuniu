import type { NextRequest } from "next/server";
import { admitNanoTask } from "@/lib/nano/admit";

/**
 * Thin compatibility route for the legacy `gemini-image` URL. It shares the
 * durable admit flow; the old payload had no requestKey, so a deterministic key
 * is derived from the request content.
 */
export async function POST(request: NextRequest) {
  return admitNanoTask(request, { requireRequestKey: false });
}
