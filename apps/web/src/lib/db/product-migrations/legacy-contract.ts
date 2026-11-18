import type { MigrationSchemaContract } from "@sunpcm/niu-persistence-pg/migrations";

/**
 * Frozen from the PG16 synthetic reference database during P1-2 acceptance.
 * This is a protocol constant, so a legacy takeover never recaptures or
 * relaxes the expected schema at runtime.
 */
export const PRODUCT_LEGACY_SCHEMA_CONTRACT: MigrationSchemaContract = {
  formatVersion: 1,
  postgresMajor: 16,
  profile: "nano_payments_cms",
  modules: [
    {
      name: "auth",
      version: 1,
      contractVersion: 1,
      checksum: "542c91dc8c53926c608a9b79c1ac2e47be453fa03d31b454c38d37c028f85211",
      rawChecksum: "33877ff1c5b99c009cd61e0667bab9ae56fe77e52fc5e1c2dac4f37ffb85e350",
    },
    {
      name: "cms_feedback",
      version: 1,
      contractVersion: 1,
      checksum: "0480a670d3304494dd779be45530ea8b37d3912f4dcc7d9750c3c962a276fee9",
      rawChecksum: "c28e0eaee8e1f173f7dd4cae7d7f4d349f66019db90733da622c341ecd38827a",
    },
    {
      name: "credits",
      version: 1,
      contractVersion: 1,
      checksum: "b636992794d99073ad47399a09402bd385480c0c1bb0592f2e24dd2881b90382",
      rawChecksum: "4d7d64f84b555c8df2d44ea7eb15e181c77301052b49bbd0201e0d93518897a9",
    },
    {
      name: "nano",
      version: 1,
      contractVersion: 1,
      checksum: "185ece8b39a3e4d6a8c0e90c66b381782b9eab2dcdaa8f4e16e34c364a727a51",
      rawChecksum: "34b8614e3d13a63d895dca64f8d39c45bcf7b6ffb5b5afd3bc0f09dfbb3e7493",
    },
    {
      name: "payments",
      version: 1,
      contractVersion: 1,
      checksum: "166db32e7021b97fdb56631c1fd219c235b4dcb4ef9a6cbd429b0c3b9f055c63",
      rawChecksum: "7de9797eeedb05006c02a180e10edc66d3b73ff9ae3cddbf0dea4e550ecdda2d",
    },
  ],
  schemaHash: "4dba14a5e8cfcb2b059e9cd4caa79d447ce8fc3d936267695edd9c9f1a9b381e",
};

/** Frozen `_n2_migration_journal` identities from the same P1-2 reference. */
export const PRODUCT_LEGACY_JOURNAL = [
  {
    name: "0000_narrow_morbius.sql",
    checksum: "23ef497ffcee915117599cfe13427a3355422e7e7fe78de64e86a87ba296d43a",
  },
  {
    name: "0001_nappy_charles_xavier.sql",
    checksum: "bb49c2ea13ef52eec131bafc92b8140c947222f50c9895586b49f77824857c61",
  },
  {
    name: "0002_nano.sql",
    checksum: "085dff500e126dc6c524cea16c1a6e6d1d7e72da822d7572bc596e531f2eb240",
  },
] as const;
