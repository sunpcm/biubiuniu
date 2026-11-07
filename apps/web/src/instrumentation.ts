export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
    const { startNanoRuntimeOnce } = await import("@/lib/nano/bootstrap");
    await startNanoRuntimeOnce();
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = async (
  err: unknown,
  request: {
    path: string;
    method: string;
    headers: Record<string, string | string[] | undefined>;
  },
  context: { routerKind: string; routePath: string; routeType: string },
) => {
  const { captureRequestError } = await import("@sentry/nextjs");
  captureRequestError(err, request, context);
};
