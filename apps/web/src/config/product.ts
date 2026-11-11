/**
 * Stable product identifier.
 *
 * This value is persisted (`nano_tasks.product_id`, `nano_case_selections.product_id`,
 * the Nano idempotency unique index) and prefixes Commerce dedupe keys. It is an
 * identifier, not a display name: every repository read, lease, and sweep filters
 * by it, so changing it makes all existing tasks invisible to the running app.
 *
 * It intentionally equals the historical value that used to be derived from
 * `siteConfig.name`. Renaming the brand must NOT change this constant; changing
 * it requires a data migration of the persisted rows.
 */
export const PRODUCT_ID = "BiuBiuNiu";
