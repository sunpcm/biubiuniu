/**
 * Nano composition — the single assembly point for the Nano coordinator and
 * provider, shared by the route handlers and the domain tests.
 *
 * The coordinator reuses the same PG store and Commerce instance as the rest of
 * the app. `enabled` (the new-admission gate) requires both the feature switch
 * and a configured API key; `provider` is created whenever the API key is
 * present so already-accepted queued tasks can still be dispatched during a
 * disabled-but-closeout window. Without a key, `provider` is null and only
 * staged/stale recovery runs.
 */
import { isNanoEnabled } from "@/config/features";
import {
  getNanoPublicConfig,
  getNanoServerConfig,
  isNanoProviderConfigured,
} from "@/config/nano";
import { nanoCases } from "@/config/nano-cases";
import { getAppCommerce } from "@/composition/commerce";
import { db } from "@/lib/db";
import {
  createCaseCatalog,
  type NanoProvider,
  type NanoCaseCatalog,
} from "@sunpcm/niu-feature-nano";
import { createGoogleNanoProvider } from "@sunpcm/niu-feature-nano/provider/google";
import { createNanoCoordinator, type NanoCoordinator } from "@sunpcm/niu-persistence-pg/nano";

export interface AppNanoRuntime {
  productId: string;
  coordinator: NanoCoordinator;
  provider: NanoProvider | null;
  enabled: boolean;
  config: ReturnType<typeof getNanoServerConfig>;
  publicConfig: ReturnType<typeof getNanoPublicConfig>;
  caseCatalog: NanoCaseCatalog;
}

export interface NanoRuntimeOptions {
  /** Product case ids. Injected by the UI owner via `@/config/nano-cases`. */
  caseIds?: readonly string[];
}

export async function createNanoRuntime(options: NanoRuntimeOptions = {}): Promise<AppNanoRuntime> {
  const { commerce, store } = await getAppCommerce();
  const config = getNanoServerConfig();
  const featureEnabled = isNanoEnabled();
  const providerReady = isNanoProviderConfigured();
  const enabled = featureEnabled && providerReady;
  const coordinator = createNanoCoordinator({ db, store, commerce, productId: commerce.productId });
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const provider =
    apiKey
      ? createGoogleNanoProvider({
          apiKey,
          model: config.model,
          timeoutMs: config.providerTimeoutMs,
        })
      : null;
  const caseIds = options.caseIds ?? nanoCases.map((entry) => entry.id);
  const caseCatalog = createCaseCatalog(caseIds);
  const publicConfig = getNanoPublicConfig(featureEnabled);
  return { productId: commerce.productId, coordinator, provider, enabled, config, publicConfig, caseCatalog };
}

let production: Promise<AppNanoRuntime> | undefined;

export function getNanoRuntime(): Promise<AppNanoRuntime> {
  production ??= createNanoRuntime();
  return production;
}
