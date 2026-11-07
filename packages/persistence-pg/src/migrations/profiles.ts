import type { MigrationProfile } from "./types.js";

/**
 * Version of the overall physical database contract this package implements.
 *
 * Distinct from each module's own `version`: this is the cross-module schema
 * contract an application checks on startup (read-only) before enabling any
 * database-backed capability.
 */
export const DATABASE_CONTRACT_VERSION = 1;

/**
 * Product migration profiles.
 *
 * A profile is an explicit set of modules, not a template that is re-rendered
 * from runtime flags. The planner expands the dependency closure and validates
 * the graph before anything is applied.
 */
export const PROFILES: Record<string, MigrationProfile> = {
  minimal: {
    name: "minimal",
    description: "No business tables; only the migration journal is created.",
    modules: [],
  },
  auth: {
    name: "auth",
    description: "Identity, organization, and attribution tables.",
    modules: ["auth"],
  },
  auth_credits: {
    name: "auth_credits",
    description:
      "Auth plus the full billing/credits ledger. Credits physically depend on payments (order_id FK), so the closure includes orders and subscriptions.",
    modules: ["auth", "payments", "credits"],
  },
  nano_payments: {
    name: "nano_payments",
    description:
      "Auth + Payments/Credits + Nano persistent tasks and case-selection stats. Nano depends on the credits ledger for the spend_tx_id association.",
    modules: ["auth", "payments", "credits", "nano"],
  },
};

export function listProfiles(): MigrationProfile[] {
  return Object.values(PROFILES);
}
