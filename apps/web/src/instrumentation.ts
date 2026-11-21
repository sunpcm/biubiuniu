export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { isNanoBootstrapPhase } = await import("@/lib/nano/bootstrap");
    if (isNanoBootstrapPhase(process.env.NEXT_PHASE)) {
      const { assertProductDatabaseCompatibility } =
        await import("@/lib/db/product-migrations/compatibility");
      try {
        await assertProductDatabaseCompatibility();
      } catch (error) {
        const message =
          error instanceof Error && error.message.startsWith("Product database compatibility check")
            ? error.message
            : "Product database compatibility check failed safely";
        console.error(message);
        process.exit(1);
      }
    }

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
