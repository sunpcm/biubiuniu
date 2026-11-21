/**
 * One explicit commerce facade graph per test file. Production keeps the lazy
 * app singleton. Nothing here installs a process-global commerce scheduler or
 * redirects another test instance.
 */
import {
  createAppCommerce,
  type AppCommerce,
  type AppCommerceOptions,
} from "@/composition/commerce";
import { createFulfillmentBilling } from "@/lib/billing/fulfillment";
import { createSourceBindingBilling } from "@/lib/billing/source-binding";
import { createReconcileBilling } from "@/lib/billing/reconcile";
import { createStripeBilling } from "@/lib/billing/stripe";
import { createCreemBilling } from "@/lib/billing/creem";
import { createPayPalBilling } from "@/lib/billing/paypal";
import { createPayPalSourceBilling } from "@/lib/billing/paypal-source";
import { createCredits } from "@/lib/credits";
import { createCreditLedger } from "@/lib/credits/ledger";

export interface DomainCommerce {
  app: AppCommerce;
  fulfillment: ReturnType<typeof createFulfillmentBilling>;
  sourceBinding: ReturnType<typeof createSourceBindingBilling>;
  reconcile: ReturnType<typeof createReconcileBilling>;
  stripe: ReturnType<typeof createStripeBilling>;
  creem: ReturnType<typeof createCreemBilling>;
  paypal: ReturnType<typeof createPayPalBilling>;
  paypalSource: ReturnType<typeof createPayPalSourceBilling>;
  credits: ReturnType<typeof createCredits>;
  ledger: ReturnType<typeof createCreditLedger>;
}

export function createDomainCommerce(options: AppCommerceOptions = {}): DomainCommerce {
  const app = createAppCommerce({
    schedulePostCommit: () => {},
    ...options,
  });
  return {
    app,
    fulfillment: createFulfillmentBilling(app),
    sourceBinding: createSourceBindingBilling(app),
    reconcile: createReconcileBilling(app),
    stripe: createStripeBilling(app),
    creem: createCreemBilling(app),
    paypal: createPayPalBilling(app),
    paypalSource: createPayPalSourceBilling(app),
    credits: createCredits(app),
    ledger: createCreditLedger(app),
  };
}
