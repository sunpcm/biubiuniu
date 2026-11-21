import type { MigrationModule } from "../types.js";
import { authModule } from "./auth.js";
import { creditsModule } from "./credits.js";
import { nanoModule } from "./nano.js";
import { paymentsModule } from "./payments.js";

/**
 * Static module manifest.
 *
 * This is the exhaustive, explicitly-imported list of migration modules. There
 * is deliberately no runtime directory scan: adding a module means editing this
 * file and bumping the corresponding profile in `profiles.ts`.
 */
export const ALL_MODULES: readonly MigrationModule[] = [
  authModule,
  paymentsModule,
  creditsModule,
  nanoModule,
];
