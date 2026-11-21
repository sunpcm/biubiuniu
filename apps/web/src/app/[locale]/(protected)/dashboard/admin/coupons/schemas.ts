/**
 * [INPUT]: Depends on zod and the CreatePromotionCodeInput /
 *          AdminPromotionCodeItem types of @/actions/coupons/admin
 * [OUTPUT]: Exports CODE_PATTERN, UNRESTRICTED_FILTER, createCouponFormSchema,
 *           CouponFormValues, EMPTY_COUPON_FORM, toCreateInput, toFormValues,
 *           generateCode, toDatetimeLocal, EXPIRY_PRESETS, presetToValue
 * [POS]: The validation and conversion source of truth of admin/coupons. Every
 *        form field is carried as a string (a controlled input has nothing
 *        else), so the string ↔ server-unit translation — cents, epoch seconds,
 *        upper-cased codes — lives here and nowhere else. CouponFormDialog only
 *        renders; the arithmetic is all in this file.
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import type {
  AdminPromotionCodeItem,
  CreatePromotionCodeInput,
} from "@/actions/coupons/admin";
import { z } from "zod";

/** Mirrors the server-side pattern; the input upper-cases as you type. */
export const CODE_PATTERN = /^[A-Z0-9_-]{3,30}$/;

/** Sentinel for the "unrestricted codes only" option of the product filter. */
export const UNRESTRICTED_FILTER = "__unrestricted__";

// ============================================================================
//  Form schema — the shape is fixed, the messages are not: the schema is built
//  with the caller's translator so shadcn's <FormMessage> renders the error
//  straight from react-hook-form, with no key-mapping layer in the dialog
// ============================================================================

const numeric = (value: string) => Number(value.trim());
const isBlank = (value: string) => value.trim() === "";

const couponFormFields = z.object({
  /** Empty = let Stripe generate the code */
  code: z.string(),
  name: z.string().max(40),
  discountType: z.enum(["percent", "amount"]),
  percentOff: z.string(),
  amountOff: z.string(),
  /** Empty = every product */
  planIds: z.array(z.string()),
  duration: z.enum(["once", "repeating", "forever"]),
  durationInMonths: z.string(),
  maxRedemptions: z.string(),
  /** Raw <input type="datetime-local"> value; empty = never expires */
  expiresAt: z.string(),
  firstTimeOnly: z.boolean(),
  /** Minimum order amount in major units; empty = no minimum */
  minimumAmount: z.string(),
});

export type CouponFormValues = z.infer<typeof couponFormFields>;

/** `t` resolves keys inside the `Coupons.formErrors` namespace. */
export function createCouponFormSchema(t: (key: string) => string) {
  return couponFormFields.superRefine((value, ctx) => {
    const invalid = (path: keyof CouponFormValues, key: string) =>
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [path],
        message: t(key),
      });

    if (!isBlank(value.code) && !CODE_PATTERN.test(value.code.trim())) {
      invalid("code", "codeFormat");
    }

    if (value.discountType === "percent") {
      const percent = numeric(value.percentOff);
      if (
        isBlank(value.percentOff) ||
        !Number.isFinite(percent) ||
        percent <= 0 ||
        percent > 100
      ) {
        invalid("percentOff", "percentRange");
      }
    } else {
      const amount = numeric(value.amountOff);
      if (isBlank(value.amountOff) || !Number.isFinite(amount) || amount <= 0) {
        invalid("amountOff", "amountPositive");
      }
    }

    if (value.duration === "repeating") {
      const months = numeric(value.durationInMonths);
      if (!Number.isInteger(months) || months < 1 || months > 36) {
        invalid("durationInMonths", "monthsRange");
      }
    }

    if (!isBlank(value.maxRedemptions)) {
      const max = numeric(value.maxRedemptions);
      if (!Number.isInteger(max) || max < 1) {
        invalid("maxRedemptions", "positiveInteger");
      }
    }

    if (!isBlank(value.minimumAmount)) {
      const min = numeric(value.minimumAmount);
      if (!Number.isFinite(min) || min <= 0) {
        invalid("minimumAmount", "amountPositive");
      }
    }

    if (!isBlank(value.expiresAt) && Date.parse(value.expiresAt) <= Date.now()) {
      invalid("expiresAt", "expiryFuture");
    }
  });
}

export const EMPTY_COUPON_FORM: CouponFormValues = {
  code: "",
  name: "",
  discountType: "percent",
  percentOff: "",
  amountOff: "",
  planIds: [],
  duration: "once",
  durationInMonths: "",
  maxRedemptions: "",
  expiresAt: "",
  firstTimeOnly: false,
  minimumAmount: "",
};

// ============================================================================
//  Conversions
// ============================================================================

/** Form strings → server units: cents for money, epoch seconds for the expiry. */
export function toCreateInput(
  values: CouponFormValues
): CreatePromotionCodeInput {
  const optionalNumber = (raw: string) =>
    isBlank(raw) ? undefined : numeric(raw);
  const optionalCents = (raw: string) =>
    isBlank(raw) ? undefined : Math.round(numeric(raw) * 100);

  return {
    code: isBlank(values.code) ? undefined : values.code.trim().toUpperCase(),
    name: isBlank(values.name) ? undefined : values.name.trim(),
    discountType: values.discountType,
    percentOff:
      values.discountType === "percent" ? numeric(values.percentOff) : undefined,
    amountOffCents:
      values.discountType === "amount"
        ? Math.round(numeric(values.amountOff) * 100)
        : undefined,
    planIds: values.planIds,
    duration: values.duration,
    durationInMonths:
      values.duration === "repeating"
        ? numeric(values.durationInMonths)
        : undefined,
    maxRedemptions: optionalNumber(values.maxRedemptions),
    expiresAt: isBlank(values.expiresAt)
      ? undefined
      : Math.floor(Date.parse(values.expiresAt) / 1000),
    firstTimeOnly: values.firstTimeOnly,
    minimumAmountCents: optionalCents(values.minimumAmount),
  };
}

/**
 * Existing code → form defaults, for "duplicate". The code itself is dropped
 * (Stripe rejects duplicates) and a past expiry is cleared, so the prefilled
 * form is always submittable as-is.
 */
export function toFormValues(item: AdminPromotionCodeItem): CouponFormValues {
  const expiresInFuture =
    item.expiresAt !== null && item.expiresAt * 1000 > Date.now();

  return {
    ...EMPTY_COUPON_FORM,
    name: item.name ?? "",
    discountType: item.percentOff !== null ? "percent" : "amount",
    percentOff: item.percentOff !== null ? String(item.percentOff) : "",
    amountOff: item.amountOff !== null ? String(item.amountOff / 100) : "",
    planIds: [...item.appliesToPlanIds],
    duration: item.duration,
    durationInMonths:
      item.durationInMonths !== null ? String(item.durationInMonths) : "",
    maxRedemptions:
      item.maxRedemptions !== null ? String(item.maxRedemptions) : "",
    expiresAt: expiresInFuture ? toDatetimeLocal(item.expiresAt! * 1000) : "",
    firstTimeOnly: item.firstTimeOnly,
    minimumAmount:
      item.minimumAmount !== null ? String(item.minimumAmount / 100) : "",
  };
}

// ============================================================================
//  Input helpers
// ============================================================================

/**
 * Random code from an alphabet without look-alikes (no O/0, I/1) — these codes
 * get read off screenshots and typed by hand, so ambiguity is a support ticket.
 */
export function generateCode(length = 8): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

/** Epoch ms → the `YYYY-MM-DDTHH:mm` shape datetime-local expects (local time). */
export function toDatetimeLocal(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Quick expiry choices; `days: null` means "never expires". */
export const EXPIRY_PRESETS: { key: string; days: number | null }[] = [
  { key: "never", days: null },
  { key: "days7", days: 7 },
  { key: "days30", days: 30 },
  { key: "days90", days: 90 },
];

export function presetToValue(days: number | null): string {
  if (days === null) return "";
  return toDatetimeLocal(Date.now() + days * 24 * 60 * 60 * 1000);
}
