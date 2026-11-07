/**
 * [INPUT]: No external dependencies (pure string encode/decode)
 * [OUTPUT]: Exports PayPalCustomIdData, encodePayPalCustomId, decodePayPalCustomId
 * [POS]: The metadata carrier of lib/paypal — PayPal has no Stripe-style
 *        metadata object, only a 127-character custom_id; the key ids are
 *        pipe-joined (userId|planId|submitProductId|organizationId), with
 *        organizationId placed last to stay backward compatible
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

export interface PayPalCustomIdData {
  userId: string;
  planId: string;
  submitProductId?: string | null;
  /** The billing organization of a team subscription — fulfillment routes credits to the org's shared pool by it. */
  organizationId?: string | null;
}

/**
 * Encode: pack the key IDs into a custom_id string.
 * 2 uuids + plan slug + 3 separators ~= 95 chars, safely under the 127 limit.
 */
export function encodePayPalCustomId(data: PayPalCustomIdData): string {
  return [
    data.userId,
    data.planId,
    data.submitProductId || "",
    data.organizationId || "",
  ].join("|");
}

/**
 * Decode: restore the key IDs from a custom_id.
 *
 * @param customId The custom_id returned by PayPal
 * @returns The parsed data, or null if the format is invalid
 */
export function decodePayPalCustomId(
  customId: string | undefined | null
): (PayPalCustomIdData & { organizationId: string | null }) | null {
  if (!customId) return null;

  const parts = customId.split("|");
  if (parts.length < 2) {
    console.warn("[PayPal] Invalid custom_id format.");
    return null;
  }

  return {
    userId: parts[0],
    planId: parts[1],
    submitProductId: parts[2] || null,
    organizationId: parts[3] || null,
  };
}
