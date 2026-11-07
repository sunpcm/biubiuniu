export const PG_INT4_MIN = -2147483648;
export const PG_INT4_MAX = 2147483647;

export function assertCreditAmount(
  amount: number,
  opts: { allowNegative?: boolean; allowZero?: boolean } = {},
): void {
  if (typeof amount !== "number" || !Number.isSafeInteger(amount)) {
    throw new Error("Credit amount must be a safe integer");
  }
  if (!opts.allowNegative && amount < 0) throw new Error("Credit amount must be non-negative");
  if (!opts.allowZero && amount === 0) throw new Error("Credit amount must be non-zero");
  if (amount < PG_INT4_MIN || amount > PG_INT4_MAX) {
    throw new Error("Credit amount exceeds PostgreSQL integer range");
  }
}

export function assertMinorAmount(amount: number, label: string): void {
  if (typeof amount !== "number" || !Number.isSafeInteger(amount)) {
    throw new Error(`${label} must be a safe integer`);
  }
  if (amount < 0) throw new Error(`${label} must be non-negative`);
  if (amount > PG_INT4_MAX) throw new Error(`${label} exceeds PostgreSQL integer range`);
}

export function assertBucket(next: { subscription: number; purchased: number }): void {
  for (const value of [next.subscription, next.purchased]) {
    if (!Number.isSafeInteger(value) || value < PG_INT4_MIN || value > PG_INT4_MAX) {
      throw new Error("Credit amount exceeds PostgreSQL integer range");
    }
  }
}

const PAYPAL_MINOR = 100n;
const PAYPAL_MAX = BigInt(PG_INT4_MAX);

export function paypalAmountToMinor(amount: string | null | undefined): number {
  if (typeof amount !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(amount)) {
    throw new Error("Invalid PayPal amount");
  }
  const [major, fraction = ""] = amount.split(".");
  const result = BigInt(major!) * PAYPAL_MINOR + BigInt(fraction.padEnd(2, "0"));
  if (result > PAYPAL_MAX) throw new Error("PayPal amount exceeds storage range");
  return Number(result);
}
