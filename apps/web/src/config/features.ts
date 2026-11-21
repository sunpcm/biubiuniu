/**
 * Single feature assembly point for paid purchase and AI generation.
 *
 * Both are closed for this task until the durable-task contract (plan §5.4)
 * ships. Keeping the switches here (instead of scattering process.env reads)
 * means API guards, route stubs, and page/CTA visibility stay consistent.
 *
 * A feature is enabled only when its DISABLE_* switch is explicitly "false".
 * Unset or any other value keeps the feature closed, so no provider is ever
 * contacted and no order/subscription/credits move until re-enabled here.
 */

/** Paid checkout/purchase (Stripe, PayPal, Creem) is available only when re-enabled. */
export function isPurchaseEnabled(): boolean {
  return process.env.DISABLE_PURCHASE === "false";
}

/** Paid AI generation (chat/image/video) is available only when re-enabled. */
export function isAiEnabled(): boolean {
  return process.env.DISABLE_AI === "false";
}

/**
 * Nano image generation is available only when explicitly re-enabled. Closed
 * still serves read/cancel/recovery for already-accepted tasks.
 */
export function isNanoEnabled(): boolean {
  return process.env.DISABLE_NANO === "false";
}
