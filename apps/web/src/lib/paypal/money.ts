const PAYPAL_MINOR_SCALE = BigInt(100);
const PAYPAL_PG_INT_MAX = BigInt('2147483647');

/** PayPal's supported two-decimal currency amounts to integer minor units. */
export function paypalAmountToMinor(amount: string | null | undefined): number {
  if (typeof amount !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(amount)) {
    throw new Error('Invalid PayPal amount');
  }
  const [major, fraction = ''] = amount.split('.');
  const result = BigInt(major!) * PAYPAL_MINOR_SCALE + BigInt(fraction.padEnd(2, '0'));
  if (result > PAYPAL_PG_INT_MAX) throw new Error('PayPal amount exceeds storage range');
  return Number(result);
}
