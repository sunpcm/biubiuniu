import {
  ALL_MODULES,
  PROFILES,
  type MigrationModule,
  type MigrationProfile,
} from "@sunpcm/niu-persistence-pg/migrations";
import { cmsFeedbackModule } from "./cms-feedback";

const productRoots = [...PROFILES.nano_payments.modules, cmsFeedbackModule.name];

const productProfile: MigrationProfile = {
  name: "nano_payments_cms",
  description: "Nano payments platform plus product-owned CMS and feedback tables",
  modules: productRoots,
};

export const PRODUCT_MIGRATION_PLAN = {
  profile: productProfile,
  modules: [...ALL_MODULES, cmsFeedbackModule] as readonly MigrationModule[],
  roots: productProfile.modules,
} as const;
