/**
 * `@sunpcm/niu-contracts` — cross-boundary primitive contracts.
 *
 * This package is a leaf: no React, Next.js, ORM, provider SDK, or environment
 * access. It exists so persistence, domain, and application layers can share
 * stable identifiers and error semantics without importing each other.
 */
export {
  type PaymentProvider,
  PAYMENT_PROVIDERS,
} from "./payment.js";
export { type EntityId, entityId } from "./identifiers.js";
export {
  AppError,
  type AppErrorOptions,
  type ErrorKind,
} from "./errors.js";
